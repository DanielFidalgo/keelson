#!/usr/bin/env bash
# Deploys Keelson from a laptop: build and push the three images, apply the Pulumi stack, migrate the database.
# CI does the same on every push to main (.github/workflows/deploy.yml); run this script for the very first deploy.
#
# One-time prerequisites, all done by hand because the stack cannot create what it runs on:
#   1. Tools: gcloud (signed in with `gcloud auth login` and `gcloud auth application-default login`), docker, pulumi, node 24.
#   2. APIs, enabled once on the project:
#        gcloud services enable run.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com \
#          secretmanager.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
#          sts.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
#          monitoring.googleapis.com logging.googleapis.com
#   3. Pulumi state bucket (PULUMI_STATE_BUCKET is its name):
#        gcloud storage buckets create "gs://$PULUMI_STATE_BUCKET" --location us-central1 --uniform-bucket-level-access
#        gcloud storage buckets update "gs://$PULUMI_STATE_BUCKET" --versioning
#   4. The bootstrap stack, applied once by you (never by CI): service accounts, secrets, custom roles, the GitHub
#      trust and the deployer's grants. The numeric repository id is shown by
#        gh api repos/DanielFidalgo/keelson --jq .id
#        export PULUMI_BACKEND_URL="gs://$PULUMI_STATE_BUCKET" PULUMI_CONFIG_PASSPHRASE=""
#        npm ci --prefix infra && npm run build --prefix infra
#        pulumi stack init bootstrap --cwd infra/bootstrap
#        pulumi config set repositoryId <id> --cwd infra/bootstrap --stack bootstrap
#        pulumi config set stateBucket "$PULUMI_STATE_BUCKET" --cwd infra/bootstrap --stack bootstrap
#        pulumi up --cwd infra/bootstrap --stack bootstrap
#      Then commit infra/bootstrap/Pulumi.bootstrap.yaml (it holds the stack's encryptionsalt) and set the repository variables
#      GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_DEPLOYER_SERVICE_ACCOUNT and GCP_PREVIEW_SERVICE_ACCOUNT from
#      `pulumi stack output --cwd infra/bootstrap --stack bootstrap`, and PULUMI_STATE_BUCKET.
#   5. Secret values. The bootstrap stack creates the empty secrets; this script stops until they hold a value:
#        printf '%s' "$NEON_DATABASE_URL" | gcloud secrets versions add database-url --data-file=-
#        openssl rand -hex 32 | gcloud secrets versions add demo-admin-token --data-file=-
#
# Required environment: PULUMI_STATE_BUCKET, ALERT_NOTIFICATION_EMAIL. Optional: IMAGE_TAG (defaults to the commit).
set -euo pipefail

STACK=dev
APPS=(api worker demo-server)
REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIRECTORY="${REPOSITORY_ROOT}/infra"

: "${PULUMI_STATE_BUCKET:?set PULUMI_STATE_BUCKET to the name of the Pulumi state bucket}"
: "${ALERT_NOTIFICATION_EMAIL:?set ALERT_NOTIFICATION_EMAIL to the address that receives probe alerts}"
export ALERT_NOTIFICATION_EMAIL
export PULUMI_BACKEND_URL="gs://${PULUMI_STATE_BUCKET}"
# No stack config is secret, so the passphrase that would encrypt it can be empty.
export PULUMI_CONFIG_PASSPHRASE="${PULUMI_CONFIG_PASSPHRASE-}"

pulumi_in_stack() {
  pulumi "$@" --cwd "$INFRA_DIRECTORY" --stack "$STACK"
}

default_image_tag() {
  local commit
  commit="$(git -C "$REPOSITORY_ROOT" rev-parse --short=12 HEAD)"
  # An image built from uncommitted changes must never be mistaken for the commit's own image.
  if [[ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain)" ]]; then
    commit="${commit}-dirty-$(date +%s)"
  fi
  echo "$commit"
}

require_secret_value() {
  local secret="$1"
  if [[ -z "$(gcloud secrets versions list "$secret" --project "$PROJECT" --filter 'state=ENABLED' --limit 1 --format 'value(name)')" ]]; then
    echo "Secret '${secret}' has no value yet. Add one (see prerequisite 5 in this script), then run it again." >&2
    exit 1
  fi
}

IMAGE_TAG="${IMAGE_TAG:-$(default_image_tag)}"

# Pulumi runs the compiled programs: its bundled TypeScript cannot read this repository's tsconfig.
npm ci --prefix "$INFRA_DIRECTORY"
npm run build --prefix "$INFRA_DIRECTORY"
# The first run creates the stack and writes its encryptionsalt into infra/Pulumi.dev.yaml. CI opens the stack with
# the same empty passphrase and needs that salt, so the file must be committed after this run (the script reminds you).
pulumi stack select "$STACK" --create --cwd "$INFRA_DIRECTORY"
PROJECT="$(pulumi_in_stack config get gcp:project)"
REGION="$(pulumi_in_stack config get gcp:region)"
REGISTRY="${REGION}-docker.pkg.dev"

# The image tag goes into a throwaway copy of the stack config, so a deploy never leaves a modified Pulumi.dev.yaml behind.
stack_config="$(mktemp)"
trap 'rm -f "$stack_config"' EXIT
cp "${INFRA_DIRECTORY}/Pulumi.${STACK}.yaml" "$stack_config"
pulumi_up() {
  pulumi_in_stack up --yes --config-file "$stack_config" --config "keelson:imageTag=${IMAGE_TAG}" "$@"
}

# Images cannot be pushed before their repository exists, so the repository is created first. Later runs find
# it in place and change nothing.
pulumi_up --target "urn:pulumi:${STACK}::keelson::gcp:artifactregistry/repository:Repository::keelson"
require_secret_value database-url
require_secret_value demo-admin-token

gcloud auth configure-docker "$REGISTRY" --quiet
for app in "${APPS[@]}"; do
  image="${REGISTRY}/${PROJECT}/keelson/${app}:${IMAGE_TAG}"
  # Cloud Run runs amd64, whatever the laptop is.
  docker build --platform linux/amd64 --build-arg APP="$app" --tag "$image" "$REPOSITORY_ROOT"
  docker push "$image"
done

pulumi_up

gcloud run jobs execute keelson-migrate --project "$PROJECT" --region "$REGION" --wait

if [[ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain -- infra/Pulumi.dev.yaml)" ]]; then
  echo "infra/Pulumi.dev.yaml changed (the new stack's encryptionsalt). Commit it, or CI cannot open the stack." >&2
fi

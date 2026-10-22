#!/usr/bin/env bash
# Proves the domain-is-pure rule fails the build, so a silently broken rule cannot pass CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
violation="$repo_root/packages/domain/src/__violation.ts"

cleanup() { rm -f "$violation"; }
trap cleanup EXIT

cd "$repo_root"
echo "import '@keelson/application';" > "$violation"

exit_code=0
output="$(npm run deps:check 2>&1)" || exit_code=$?

if [ "$exit_code" -eq 0 ]; then
  echo "FAIL: deps:check passed despite a domain to application import" >&2
  echo "$output" >&2
  exit 1
fi

if ! grep -q 'domain-is-pure' <<<"$output"; then
  echo "FAIL: deps:check failed but did not name rule domain-is-pure" >&2
  echo "$output" >&2
  exit 1
fi

echo "PASS: domain-is-pure rejected the violation"

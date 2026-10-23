#!/usr/bin/env bash
# Proves each guarded rule fails the build, so a silently broken rule cannot pass CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

created_files=()
created_dirs=()

cleanup() {
  rm -f "${created_files[@]+"${created_files[@]}"}"
  # Only directories this script created are removed, so a real apps/api is never touched.
  rmdir "${created_dirs[@]+"${created_dirs[@]}"}" 2>/dev/null || true
}
trap cleanup EXIT

# expect_rule_violation <rule name> <file to create> <import statement written into it>
expect_rule_violation() {
  local rule="$1" violation="$2" statement="$3"
  local directory
  directory="$(dirname "$violation")"
  while [ ! -d "$directory" ]; do
    created_dirs+=("$directory")
    directory="$(dirname "$directory")"
  done
  mkdir -p "$(dirname "$violation")"
  created_files+=("$violation")
  echo "$statement" > "$violation"

  local exit_code=0 output
  output="$(npm run deps:check 2>&1)" || exit_code=$?

  if [ "$exit_code" -eq 0 ]; then
    echo "FAIL: deps:check passed despite a $rule violation" >&2
    echo "$output" >&2
    exit 1
  fi

  if ! grep -q "$rule" <<<"$output"; then
    echo "FAIL: deps:check failed but did not name rule $rule" >&2
    echo "$output" >&2
    exit 1
  fi

  rm -f "$violation"
  echo "PASS: $rule rejected the violation"
}

expect_rule_violation domain-is-pure \
  "$repo_root/packages/domain/src/__violation.ts" \
  "import '@keelson/application';"

expect_rule_violation api-no-untrusted-egress \
  "$repo_root/apps/api/src/__violation.ts" \
  "import '@keelson/infrastructure/egress';"

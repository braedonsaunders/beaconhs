#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

write_permissions="$({
  grep -ERn --include='*.yml' --include='*.yaml' \
    '^[[:space:]]*contents:[[:space:]]*write([[:space:]]*(#.*)?)?$' \
    .github/workflows || true
})"

if [ -n "$write_permissions" ]; then
  echo 'GitHub workflows must not receive repository-content write permission.' >&2
  echo 'A workflow commit can advance main while an older SHA is being tested and deployed.' >&2
  printf '%s\n' "$write_permissions" >&2
  exit 1
fi

echo 'PASS GitHub workflows cannot mutate repository contents'

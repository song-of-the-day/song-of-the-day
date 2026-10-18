#!/usr/bin/env bash
# Run a frontend tool from frontend/ on the files pre-commit passes (repo-root relative).
#
#   scripts/frontend-hook.sh <tool> [args ...] -- <file ...>
#
# e.g. `scripts/frontend-hook.sh eslint --max-warnings=0 -- frontend/src/app/App.tsx` runs
# `pnpm exec eslint --max-warnings=0 src/app/App.tsx` inside frontend/, so the tool picks up
# the package's own configuration and dependencies.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repo_root

args=()
while [[ $# -gt 0 && "$1" != "--" ]]; do
  args+=("$1")
  shift
done
if [[ $# -eq 0 ]]; then
  echo "usage: $0 <tool> [args ...] -- <file ...>" >&2
  exit 2
fi
shift

files=()
for file in "$@"; do
  files+=("${file#frontend/}")
done
if [[ ${#files[@]} -eq 0 ]]; then
  exit 0
fi

cd "${repo_root}/frontend"
exec pnpm exec "${args[@]}" "${files[@]}"

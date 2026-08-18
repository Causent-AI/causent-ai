#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine_python="${CAUSENT_ENGINE_PYTHON:-$repo_root/engine/.venv/bin/python}"

if [[ ! -x "$engine_python" && -z "${CAUSENT_ENGINE_PYTHON:-}" ]]; then
  common_git_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)"
  main_checkout="$(dirname "$common_git_dir")"
  if [[ -x "$main_checkout/engine/.venv/bin/python" ]]; then
    engine_python="$main_checkout/engine/.venv/bin/python"
  fi
fi

if [[ ! -x "$engine_python" ]]; then
  echo "Missing engine Python at $engine_python" >&2
  echo "Create engine/.venv or set CAUSENT_ENGINE_PYTHON to the project interpreter." >&2
  exit 1
fi

cd "$repo_root"
"$engine_python" scripts/check_hot_query_plans.py

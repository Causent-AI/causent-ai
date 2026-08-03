#!/bin/bash
# Stage and deploy the automatic causal recomputation worker as the standalone
# Vercel project `causent-recompute`. The worker is stateful: it drains the
# private Postgres queue and materializes causal graph rows, so it must not share
# the credential-free `causent-engine` project or the Next.js app bundle.
#
# Usage:
#   scripts/deploy-recompute.sh              # preview deploy
#   scripts/deploy-recompute.sh preview      # explicit preview deploy
#   scripts/deploy-recompute.sh --prod       # production deploy
#   scripts/deploy-recompute.sh --stage-only /tmp/causent-recompute-check
#
# The stage-only form performs no network calls. It exists so CI and local
# verification can inspect the exact upload without linking or deploying.
#
# Required Vercel project env (preview + production):
#   DATABASE_URL                 Supabase session-pooler DSN
#   CAUSENT_RECOMPUTE_SECRET     shared secret sent by the Next.js app
#
# The Next.js app separately needs CAUSENT_RECOMPUTE_URL,
# CAUSENT_RECOMPUTE_SECRET, and CRON_SECRET. See api/DEPLOY.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-preview}"
STAGE_ONLY=0
DEPLOY_ARGS=()

case "$MODE" in
  preview)
    if (( $# > 1 )); then
      echo "usage: $0 [preview|--prod|--stage-only PATH]" >&2
      exit 2
    fi
    ;;
  --prod)
    if (( $# > 1 )); then
      echo "usage: $0 [preview|--prod|--stage-only PATH]" >&2
      exit 2
    fi
    DEPLOY_ARGS=(--prod)
    ;;
  --stage-only)
    if (( $# != 2 )); then
      echo "usage: $0 --stage-only PATH" >&2
      exit 2
    fi
    STAGE_ONLY=1
    ;;
  *)
    echo "usage: $0 [preview|--prod|--stage-only PATH]" >&2
    exit 2
    ;;
esac

if (( STAGE_ONLY )); then
  STAGE="$2"
  if [[ -e "$STAGE" ]]; then
    echo "stage path already exists: $STAGE" >&2
    exit 2
  fi
else
  STAGE="$(mktemp -d)/causent-recompute"
fi

mkdir -p "$STAGE/api" "$STAGE/engine/persistence" "$STAGE/engine/causal"
cp "$REPO/api/recompute.py" "$STAGE/api/"

# Keep the stateful bundle deliberately narrow. recompute -> bridge -> the
# batch-readout dependency chain; demo, resolution, and drift runners do not ship.
PERSISTENCE_MODULES=(
  __init__.py
  bridge.py
  recompute.py
)
CAUSAL_MODULES=(
  __init__.py
  batch_readout.py
  before_after_14d.py
  belief_direction.py
  descriptive.py
  its_readout.py
  placebo_in_time.py
  segmented_ols.py
  step_ci.py
  t_ppf.py
  types.py
)

for module in "${PERSISTENCE_MODULES[@]}"; do
  cp "$REPO/engine/persistence/$module" "$STAGE/engine/persistence/"
done
for module in "${CAUSAL_MODULES[@]}"; do
  cp "$REPO/engine/causal/$module" "$STAGE/engine/causal/"
done

# Exact versions match the verified Slice 10 engine environment and keep remote
# builds reproducible.
cat > "$STAGE/requirements.txt" <<'REQS'
numpy==2.5.0
psycopg[binary]==3.3.4
REQS

cat > "$STAGE/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/recompute.py": {
      "memory": 1024,
      "maxDuration": 300,
      "includeFiles": "engine/**"
    }
  }
}
JSON

cat > "$STAGE/pyproject.toml" <<'TOML'
[project]
name = "causent-recompute"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = ["numpy==2.5.0", "psycopg[binary]==3.3.4"]

[tool.vercel]
entrypoint = "api.recompute:handler"
TOML

if (( STAGE_ONLY )); then
  printf '%s\n' "$STAGE"
  exit 0
fi

cd "$STAGE"
npx vercel link --yes --project causent-recompute
npx vercel deploy "${DEPLOY_ARGS[@]}"

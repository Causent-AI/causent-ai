#!/bin/bash
# Stage and deploy the baseline-drift materialization worker as the standalone
# Vercel project `causent-drift`. The worker holds a Postgres DSN and replaces a
# durable workspace projection, so it remains isolated from the app and the
# credential-free causal engine.
#
# Usage:
#   scripts/deploy-drift.sh              # preview deploy
#   scripts/deploy-drift.sh preview      # explicit preview deploy
#   scripts/deploy-drift.sh --prod       # production canary, no alias promotion
#   scripts/deploy-drift.sh --stage-only /tmp/causent-drift-check
#
# `--prod` deliberately passes `--skip-domain`. Canary the returned deployment
# URL before using `vercel@56.0.0 promote <url> --scope "$VERCEL_ORG_ID"`.
#
# The stage-only form performs no network calls. It exists so CI and local
# verification can inspect the exact upload without linking or deploying.
#
# Required Vercel project env (preview + production):
#   DATABASE_URL                Supabase session-pooler DSN
#   CAUSENT_DRIFT_SECRET        shared secret sent by the Next.js app
# Required local deploy context (not required by --stage-only):
#   VERCEL_ORG_ID               exact Vercel team ID that owns causent-drift
#
# The Next.js app separately needs CAUSENT_DRIFT_URL, CAUSENT_DRIFT_SECRET,
# and CRON_SECRET.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERCEL_CLI_VERSION="56.0.0"
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
    DEPLOY_ARGS=(--prod --skip-domain)
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

if (( ! STAGE_ONLY )) && [[ -z "${VERCEL_ORG_ID:-}" ]]; then
  echo "VERCEL_ORG_ID is required to link the exact Vercel team" >&2
  exit 2
fi

if (( STAGE_ONLY )); then
  STAGE="$2"
  if [[ -e "$STAGE" || -L "$STAGE" ]]; then
    echo "stage path already exists: $STAGE" >&2
    exit 2
  fi
else
  STAGE="$(mktemp -d)/causent-drift"
fi

mkdir -p "$STAGE/api" "$STAGE/engine/persistence" "$STAGE/engine/causal"
cp "$REPO/api/drift.py" "$STAGE/api/"

# Keep the bundle to drift materialization's explicit import closure. The
# bridge imports the causal readout module set, so those dependencies remain.
PERSISTENCE_MODULES=(
  __init__.py
  bridge.py
  drift_materialization.py
  drift_read.py
  worker_runtime.py
)
CAUSAL_MODULES=(
  __init__.py
  batch_readout.py
  before_after_14d.py
  belief_direction.py
  descriptive.py
  drift.py
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

cat > "$STAGE/requirements.txt" <<'REQS'
numpy==2.5.0
psycopg[binary]==3.3.4
REQS

cat > "$STAGE/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/drift.py": {
      "memory": 1024,
      "maxDuration": 300,
      "includeFiles": "engine/**"
    }
  }
}
JSON

cat > "$STAGE/pyproject.toml" <<'TOML'
[project]
name = "causent-drift"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = ["numpy==2.5.0", "psycopg[binary]==3.3.4"]

[tool.vercel]
entrypoint = "api.drift:handler"
TOML

if (( STAGE_ONLY )); then
  printf '%s\n' "$STAGE"
  exit 0
fi

(cd "$REPO" && npm run check:drift-config)

cd "$STAGE"
npx --yes "vercel@$VERCEL_CLI_VERSION" link --yes \
  --team "$VERCEL_ORG_ID" --project causent-drift
EXPECTED_VERCEL_ORG_ID="$VERCEL_ORG_ID" EXPECTED_VERCEL_PROJECT="causent-drift" \
  node -e '
    const fs = require("node:fs");
    const linked = JSON.parse(fs.readFileSync(".vercel/project.json", "utf8"));
    if (linked.orgId !== process.env.EXPECTED_VERCEL_ORG_ID ||
        linked.projectName !== process.env.EXPECTED_VERCEL_PROJECT) {
      console.error("linked Vercel project does not match the expected worker target");
      process.exit(1);
    }
  '
npx --yes "vercel@$VERCEL_CLI_VERSION" deploy --yes "${DEPLOY_ARGS[@]}"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine_python="${CAUSENT_ENGINE_PYTHON:-$repo_root/engine/.venv/bin/python}"

# Codex worktrees intentionally do not duplicate the large Python venv. Reuse
# the main checkout's project venv when this worktree has none.
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
supabase db reset

cd "$repo_root/engine"
"$engine_python" persistence/seed_demo.py

cd "$repo_root"
supabase db query \
  "insert into public.decision_report_rollouts (scope_id, user_id, enabled, rollout_note) values
   ('ca5e0000-0000-0000-0000-0000000000d3', 'ca5e1111-0000-0000-0000-0000000000d9', true, 'Local Gummy Alpha verification'),
   ('ca5e0000-0000-0000-0000-0000000000d5', 'ca5e1111-0000-0000-0000-0000000000d9', true, 'Local Northstar verification')
   on conflict (scope_id, user_id) do update set enabled = excluded.enabled, rollout_note = excluded.rollout_note, updated_at = now()" \
  --local -o table

supabase db query \
  "do \$verify\$
   begin
     if not exists (
       select 1 from public.workspaces
       where workspace_id = 'ca5e0000-0000-0000-0000-0000000000d3'
     ) then raise exception 'Demo workspace was not seeded.'; end if;
     if not exists (
       select 1 from public.workspaces
       where workspace_id = 'ca5e0000-0000-0000-0000-0000000000d5'
     ) then raise exception 'Northstar workspace was not seeded.'; end if;
     if (select count(*) from public.actions
         where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3') < 13 then
       raise exception 'Demo actions were not seeded.';
     end if;
     if not coalesce((
       select enabled from public.decision_report_rollouts
       where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3'
         and user_id = 'ca5e1111-0000-0000-0000-0000000000d9'
     ), false) then raise exception 'Decision Report rollout was not restored.'; end if;
     if not coalesce((
       select enabled from public.decision_report_rollouts
       where scope_id = 'ca5e0000-0000-0000-0000-0000000000d5'
         and user_id = 'ca5e1111-0000-0000-0000-0000000000d9'
     ), false) then raise exception 'Northstar Decision Report rollout was not restored.'; end if;
   end
   \$verify\$" \
  --local -o table

echo "Local database reset, demo data seeded, and Decision Report rollout restored."

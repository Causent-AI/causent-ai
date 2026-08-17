"""Deterministic staging-scale data fixture with a safe plan-first CLI.

The fixture appends namespaced metrics, observations, actions, decisions, graph
nodes, edges, and evidence to one explicitly selected workspace. It never
deletes existing rows. Remote application requires two independent opt-ins.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from datetime import date
from urllib.parse import urlparse
from uuid import UUID


LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DEFAULT_SCOPE = UUID("ca5e0000-0000-0000-0000-0000000000d3")


@dataclass(frozen=True)
class ScaleProfile:
    metrics: int
    days: int
    actions: int
    decisions: int

    @property
    def observation_rows(self) -> int:
        return self.metrics * self.days

    @property
    def evidence_rows(self) -> int:
        return self.actions


PROFILES = {
    "smoke": ScaleProfile(metrics=5, days=90, actions=50, decisions=20),
    "steady": ScaleProfile(metrics=25, days=730, actions=1_000, decisions=500),
    "gigabyte": ScaleProfile(metrics=5_000, days=3_000, actions=50_000, decisions=20_000),
}


def is_local_dsn(dsn: str) -> bool:
    host = (urlparse(dsn).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def fixture_plan(profile_name: str, scope_id: UUID, dsn: str) -> dict[str, object]:
    profile = PROFILES[profile_name]
    # Planning estimate only. PostgreSQL tuple/index/JSON overhead varies with
    # version, fillfactor, replicas, and retained WAL.
    estimated_bytes = profile.observation_rows * 80 + profile.actions * 1_200 + profile.decisions * 700
    return {
        "profile": profile_name,
        "scopeId": str(scope_id),
        **asdict(profile),
        "observationRows": profile.observation_rows,
        "evidenceRows": profile.evidence_rows,
        "estimatedBytes": estimated_bytes,
        "estimatedGiB": round(estimated_bytes / (1024**3), 2),
        "databaseHost": urlparse(dsn).hostname,
        "estimateOnly": True,
    }


def assert_apply_allowed(dsn: str, profile_name: str, allow_remote: bool, confirm_gigabyte: bool) -> None:
    if profile_name == "gigabyte" and not confirm_gigabyte:
        raise ValueError("The gigabyte profile requires --confirm-gigabyte.")
    if is_local_dsn(dsn):
        return
    if not allow_remote or os.environ.get("CAUSENT_SCALE_FIXTURE_ALLOW") != "staging":
        raise ValueError(
            "Remote fixture writes require --allow-remote and CAUSENT_SCALE_FIXTURE_ALLOW=staging."
        )


def apply_fixture(dsn: str, scope_id: UUID, profile: ScaleProfile) -> None:
    import psycopg

    end_date = date(2026, 8, 16)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select 1 from public.workspaces where workspace_id = %s",
                (scope_id,),
            )
            if cursor.fetchone() is None:
                raise RuntimeError("The target workspace does not exist.")

        metric_batch = 100
        for first in range(1, profile.metrics + 1, metric_batch):
            last = min(profile.metrics, first + metric_batch - 1)
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into public.metrics (metric_id, scope_id, name, source, granularity, unit)
                    select
                      md5('causent-scale:' || %s::text || ':metric:' || metric_no::text)::uuid,
                      %s,
                      'LOAD Metric ' || lpad(metric_no::text, 5, '0'),
                      'csv',
                      'daily',
                      'count'
                    from generate_series(%s, %s) as metric_no
                    on conflict (metric_id) do nothing
                    """,
                    (scope_id, scope_id, first, last),
                )
                cursor.execute(
                    """
                    insert into public.metric_observations (metric_id, obs_date, value)
                    select
                      md5('causent-scale:' || %s::text || ':metric:' || metric_no::text)::uuid,
                      %s::date - (day_no - 1),
                      1000 + metric_no * 0.01 + day_no * 0.1 + ((metric_no + day_no) %% 7)
                    from generate_series(%s, %s) as metric_no
                    cross join generate_series(1, %s) as day_no
                    on conflict (metric_id, obs_date) do update set value = excluded.value
                    """,
                    (scope_id, end_date, first, last, profile.days),
                )
            connection.commit()

        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.actions (
                  action_id, scope_id, source, external_ref, ship_ts, effective_date, status, rationale_richtext
                )
                select
                  md5('causent-scale:' || %s::text || ':action:' || action_no::text)::uuid,
                  %s,
                  'manual',
                  'scale:action:' || action_no,
                  (%s::date - (action_no %% %s))::timestamptz,
                  %s::date - (action_no %% %s),
                  'complete',
                  jsonb_build_object('type', 'doc', 'meta', jsonb_build_object('load_fixture', true))
                from generate_series(1, %s) as action_no
                on conflict (action_id) do nothing
                """,
                (scope_id, scope_id, end_date, profile.days, end_date, profile.days, profile.actions),
            )
            cursor.execute(
                """
                insert into public.decisions (decision_id, scope_id, title, created_at)
                select
                  md5('causent-scale:' || %s::text || ':decision:' || decision_no::text)::uuid,
                  %s,
                  'LOAD Decision ' || lpad(decision_no::text, 5, '0'),
                  (%s::date - (decision_no %% %s))::timestamptz
                from generate_series(1, %s) as decision_no
                on conflict (decision_id) do nothing
                """,
                (scope_id, scope_id, end_date, profile.days, profile.decisions),
            )
            cursor.execute(
                """
                insert into public.decision_actions (decision_id, action_id)
                select
                  md5('causent-scale:' || %s::text || ':decision:' || decision_no::text)::uuid,
                  md5('causent-scale:' || %s::text || ':action:' || (((decision_no - 1) %% %s) + 1)::text)::uuid
                from generate_series(1, %s) as decision_no
                on conflict (decision_id, action_id) do nothing
                """,
                (scope_id, scope_id, profile.actions, profile.decisions),
            )
        connection.commit()

        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.nodes (node_id, scope_id, type, semantic_ref, display_name)
                select
                  md5('causent-scale:' || %s::text || ':metric-node:' || metric_no::text)::uuid,
                  %s,
                  'METRIC',
                  md5('causent-scale:' || %s::text || ':metric:' || metric_no::text)::uuid,
                  'LOAD Metric ' || lpad(metric_no::text, 5, '0')
                from generate_series(1, %s) as metric_no
                on conflict (node_id) do nothing
                """,
                (scope_id, scope_id, scope_id, profile.metrics),
            )
            cursor.execute(
                """
                insert into public.nodes (node_id, scope_id, type, semantic_ref, display_name)
                select
                  md5('causent-scale:' || %s::text || ':action-node:' || action_no::text)::uuid,
                  %s,
                  'ACTION',
                  md5('causent-scale:' || %s::text || ':action:' || action_no::text)::uuid,
                  'LOAD Action ' || lpad(action_no::text, 5, '0')
                from generate_series(1, %s) as action_no
                on conflict (node_id) do nothing
                """,
                (scope_id, scope_id, scope_id, profile.actions),
            )
            cursor.execute(
                """
                insert into public.causal_edges (
                  edge_id, scope_id, source_node_id, target_node_id, direction, belief_score
                )
                select
                  md5('causent-scale:' || %s::text || ':edge:' || action_no::text)::uuid,
                  %s,
                  md5('causent-scale:' || %s::text || ':action-node:' || action_no::text)::uuid,
                  md5('causent-scale:' || %s::text || ':metric-node:' || (((action_no - 1) %% %s) + 1)::text)::uuid,
                  case when action_no %% 2 = 0 then 'POSITIVE' else 'INCONCLUSIVE' end,
                  case when action_no %% 2 = 0 then 1 else null end
                from generate_series(1, %s) as action_no
                on conflict (edge_id) do nothing
                """,
                (scope_id, scope_id, scope_id, scope_id, profile.metrics, profile.actions),
            )
            cursor.execute(
                """
                insert into public.evidence_objects (
                  evidence_id, scope_id, edge_id, action_id, methodology, lift,
                  ci_low, ci_high, n_pre, n_post, created_at
                )
                select
                  md5('causent-scale:' || %s::text || ':evidence:' || action_no::text)::uuid,
                  %s,
                  md5('causent-scale:' || %s::text || ':edge:' || action_no::text)::uuid,
                  md5('causent-scale:' || %s::text || ':action:' || action_no::text)::uuid,
                  'ITS',
                  (action_no %% 20) * 0.1,
                  (action_no %% 20) * 0.1 - 0.05,
                  (action_no %% 20) * 0.1 + 0.05,
                  90,
                  90,
                  (%s::date - (action_no %% %s))::timestamptz
                from generate_series(1, %s) as action_no
                on conflict (evidence_id) do nothing
                """,
                (scope_id, scope_id, scope_id, scope_id, end_date, profile.days, profile.actions),
            )
        connection.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=PROFILES, default="smoke")
    parser.add_argument("--scope-id", type=UUID, default=DEFAULT_SCOPE)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--allow-remote", action="store_true")
    parser.add_argument("--confirm-gigabyte", action="store_true")
    args = parser.parse_args()
    dsn = os.environ.get("DATABASE_URL", LOCAL_DSN)
    plan = fixture_plan(args.profile, args.scope_id, dsn)
    print(json.dumps(plan, indent=2, sort_keys=True))
    if not args.apply:
        return
    assert_apply_allowed(dsn, args.profile, args.allow_remote, args.confirm_gigabyte)
    apply_fixture(dsn, args.scope_id, PROFILES[args.profile])
    print(json.dumps({"event": "scale_fixture_applied", "profile": args.profile}))


if __name__ == "__main__":
    main()

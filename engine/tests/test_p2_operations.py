"""Real database admission, cancellation, authorization and resolver fairness."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest

from test_recompute_worker import DSN, ACTOR, FOREIGN_ACTOR, ORG, PROJECT, SCOPE, seeded  # noqa: F401

MODEL = "anthropic/claude-sonnet-5"


def admit(conn, request=None, actor=ACTOR, scope=SCOPE, model=MODEL, fixture=False, digest="a" * 64):
    return conn.execute("select public.admit_report_generation(%s,%s,%s,%s,%s,%s)",
                        (request or uuid4(), scope, actor, digest, model, fixture)).fetchone()[0]


def state(conn, request, operation="read", actor=ACTOR, result=None):
    return conn.execute("select public.report_generation_state(%s,%s,%s,%s,%s::jsonb)",
                        (request, SCOPE, actor, operation, result)).fetchone()[0]["status"]


def test_generation_replay_conflict_cancellation_and_fail_closed(seeded):
    conn = seeded
    request = uuid4()
    assert admit(conn, request)["status"] == "admitted"
    assert admit(conn, request)["status"] == "running"
    assert admit(conn, request, digest="b" * 64)["status"] == "conflict"
    assert admit(conn, actor=FOREIGN_ACTOR)["status"] == "forbidden"
    assert admit(conn, model="unpriced/model")["status"] == "unpriced_model"
    # Cancel remains actor-bound after the browser switches workspaces.
    assert conn.execute("select public.report_generation_state(%s,null,%s,'cancel',null)", (request,ACTOR)).fetchone()[0]["status"] == "cancel_requested"
    assert admit(conn)["status"] == "busy"  # slot retained until abort acknowledged
    assert state(conn, request, "complete", result='{"draft":"late"}') == "cancelled"
    assert admit(conn, request)["result"] is None
    assert conn.execute("select reserved_microusd from private.generation_requests where request_id=%s", (request,)).fetchone()[0] == 2_000_000
    second = uuid4()
    assert admit(conn, second)["status"] == "busy"
    conn.execute("update private.generation_requests set expires_at=now()-interval '1 second' where request_id=%s", (request,))
    assert admit(conn, second)["status"] == "admitted"
    assert state(conn, second, "complete", result='{"draft":"kept","mode":"fixture"}') == "completed"
    assert admit(conn, second)["result"] == {"draft": "kept", "mode": "fixture"}
    assert state(conn, second, "cancel") == "completed"


def test_generation_daily_budget_rate_and_expiry(seeded):
    conn = seeded
    request = uuid4()
    assert admit(conn, request)["status"] == "admitted"
    conn.execute("update private.generation_requests set expires_at=now()-interval '1 second' where request_id=%s", (request,))
    assert admit(conn, request)["status"] == "expired"
    conn.execute("update private.generation_budgets set daily_microusd=2000000 where org_id=%s", (ORG,))
    assert admit(conn)["status"] == "budget_exhausted"
    conn.execute("update private.generation_budgets set daily_microusd=20000000,requests_per_minute=1 where org_id=%s", (ORG,))
    assert admit(conn)["status"] == "rate_limited"


def test_concurrent_generation_admission_across_connections(seeded):
    conn = seeded
    conn.commit()

    def attempt(_):
        with psycopg.connect(DSN) as worker:
            worker.execute("set local role service_role")
            return admit(worker)["status"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = list(pool.map(attempt, range(6)))
    assert statuses.count("admitted") == 1
    assert statuses.count("busy") == 5


def test_tenant_concurrency_and_foreign_result_isolation(seeded):
    conn = seeded
    conn.execute("insert into public.memberships(user_id,org_id,role) values(%s,%s,'member')", (FOREIGN_ACTOR,ORG))
    first = uuid4()
    assert admit(conn, first)["status"] == "admitted"
    conn.execute("update private.generation_budgets set concurrency=1 where org_id=%s", (ORG,))
    assert admit(conn, actor=FOREIGN_ACTOR)["status"] == "busy"
    assert admit(conn, first, actor=FOREIGN_ACTOR)["status"] == "conflict"
    assert state(conn, first, "cancel", actor=FOREIGN_ACTOR) == "missing"


def test_operational_functions_and_private_tables_are_service_only(seeded):
    conn = seeded
    functions = ["admit_report_generation", "report_generation_state", "claim_resolution_targets", "finish_resolution_target"]
    rows = conn.execute("select oid,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=any(%s)", (functions,)).fetchall()
    assert len(rows) == 4
    for oid, config in rows:
        assert 'search_path=""' in config
        for role in ("anon", "authenticated"):
            assert not conn.execute("select has_function_privilege(%s,%s,'EXECUTE')", (role,oid)).fetchone()[0]
        assert conn.execute("select has_function_privilege('service_role',%s,'EXECUTE')", (oid,)).fetchone()[0]
    for table in ("generation_requests", "generation_budgets", "resolution_dispatch"):
        for role in ("anon", "authenticated", "service_role"):
            assert not conn.execute("select has_table_privilege(%s,%s,'SELECT,INSERT,UPDATE,DELETE')", (role,"private."+table)).fetchone()[0]


def test_resolution_claim_retry_fairness_and_stale_completion(seeded):
    conn = seeded
    # Add a second due workspace with no membership; discovery must still lease
    # it, and actor validation will fail closed in the application.
    scope, metric, decision = uuid4(), uuid4(), uuid4()
    conn.execute("insert into public.workspaces(workspace_id,project_id,name) values(%s,%s,'next')", (scope,PROJECT))
    conn.execute("insert into public.metrics(metric_id,scope_id,name,source,granularity) values(%s,%s,'next','csv','daily')", (metric,scope))
    conn.execute("insert into public.decisions(decision_id,scope_id,title,created_by) values(%s,%s,'next',%s)", (decision,scope,ACTOR))
    conn.execute("insert into public.predictions(scope_id,decision_id,metric_id,direction,magnitude_pct_mean,resolution_date,committed_by) values(%s,%s,%s,'POSITIVE',10,'2026-01-01',%s)", (scope,decision,metric,ACTOR))
    conn.execute("update public.predictions set resolution_date='2026-01-01' where scope_id=%s", (SCOPE,))
    # Other fixture workspaces are outside this fixture's dates.
    first = conn.execute("select public.claim_resolution_targets('2026-01-02',1)").fetchone()[0]
    assert len(first["rows"]) == 1 and first["truncated"]
    row = first["rows"][0]
    assert conn.execute("select public.finish_resolution_target(%s,%s,'no_eligible_actor')", (row["workspace_id"],row["claim_id"])).fetchone()[0]
    second = conn.execute("select public.claim_resolution_targets('2026-01-02',1)").fetchone()[0]
    assert len(second["rows"]) == 1
    assert second["rows"][0]["workspace_id"] != row["workspace_id"]
    assert not conn.execute("select public.finish_resolution_target(%s,%s,null)", (row["workspace_id"],uuid4())).fetchone()[0]
    retry = conn.execute("select failures,last_error_code,next_attempt_at>now()+interval '59 minutes' from private.resolution_dispatch where scope_id=%s", (row["workspace_id"],)).fetchone()
    assert retry == (1, "no_eligible_actor", True)


def test_recompute_exposes_timings_without_source_data(seeded):
    from persistence.recompute import process_next_recompute_job
    result = process_next_recompute_job(seeded, scope_id=SCOPE)
    assert result is not None and result.timings_ms is not None
    assert set(result.timings_ms) >= {"claim", "target", "input", "total", "lock_held_upper"}
    assert all(isinstance(value,float) and value>=0 for value in result.timings_ms.values())
    assert result.timings_ms["lock_held_upper"] == result.timings_ms["total"]
    print("recompute_timings_ms", result.timings_ms)


def test_lock_upper_bound_includes_time_before_claim_returns(seeded, monkeypatch):
    from time import sleep
    import persistence.recompute as worker
    original = worker._claim_job

    def delayed_claim(conn, **kwargs):
        job = original(conn, **kwargs)
        with psycopg.connect(DSN) as competing:
            with pytest.raises(psycopg.errors.LockNotAvailable):
                competing.execute("select 1 from private.causal_recompute_jobs where activation_id=%s for update nowait", (job.activation_id,))
        sleep(0.04)  # The lock is held while the claimed row is being returned.
        return job

    monkeypatch.setattr(worker, "_claim_job", delayed_claim)
    result = worker.process_next_recompute_job(seeded, scope_id=SCOPE)
    assert result.timings_ms["claim"] >= 40
    assert result.timings_ms["lock_held_upper"] >= result.timings_ms["post_claim"] + 40

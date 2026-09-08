"""Real-login writer authority, coherent history, identity and concurrent ingestion."""

from __future__ import annotations

import contextlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import json
import os
from threading import Barrier
from uuid import uuid4

import psycopg
from psycopg import errors, sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.types.json import Jsonb
import pytest

from persistence.bridge import persist_legacy_metric_readouts as persist_metric_readouts

DSN = os.environ.get(
    "CAUSENT_TEST_DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)


@pytest.fixture(scope="module")
def fixture():
    (
        org,
        project,
        scope,
        foreign_scope,
        metric,
        foreign_metric,
        action,
        user,
        outsider,
    ) = [uuid4() for _ in range(9)]
    password = str(uuid4())
    member_login = f"t01_member_{uuid4().hex[:12]}"
    with psycopg.connect(DSN, autocommit=True) as admin:
        admin.execute(
            "insert into auth.users(id, email) values (%s,%s),(%s,%s)",
            (user, f"{user}@example.invalid", outsider, f"{outsider}@example.invalid"),
        )
        admin.execute(
            "insert into public.orgs(org_id,name) values (%s,'T01–T04 tests')", (org,)
        )
        admin.execute(
            "insert into public.projects(project_id,org_id,name) values (%s,%s,'tests')",
            (project, org),
        )
        admin.execute(
            "insert into public.workspaces(workspace_id,project_id,name) values (%s,%s,'home'),(%s,%s,'foreign')",
            (scope, project, foreign_scope, project),
        )
        admin.execute(
            "insert into public.memberships(user_id,org_id,workspace_id,role) values (%s,%s,%s,'member'),(%s,%s,%s,'member')",
            (user, org, scope, outsider, org, foreign_scope),
        )
        admin.execute(
            "insert into public.metrics(metric_id,scope_id,name,source,unit) values (%s,%s,'test','csv','count'),(%s,%s,'foreign','csv','count')",
            (metric, scope, foreign_metric, foreign_scope),
        )
        admin.execute(
            "insert into public.actions(action_id,scope_id,source,effective_date) values (%s,%s,'manual','2026-03-02')",
            (action, scope),
        )
        start = date(2026, 1, 1)
        with admin.cursor() as cur:
            cur.executemany(
                "insert into public.metric_observations(metric_id,obs_date,value) values (%s,%s,%s)",
                [
                    (
                        metric,
                        start + timedelta(days=i),
                        100 + i % 7 + (20 if i >= 60 else 0),
                    )
                    for i in range(120)
                ],
            )
        admin.execute(
            sql.SQL("create role {} login noinherit password {}").format(
                sql.Identifier(member_login), sql.Literal(password)
            )
        )
        admin.execute(
            sql.SQL("grant authenticated to {} with inherit false, set true").format(
                sql.Identifier(member_login)
            )
        )
        for role in ("causent_recompute_worker", "causent_resolve_worker"):
            admin.execute(
                sql.SQL("alter role {} login password {}").format(
                    sql.Identifier(role), sql.Literal(password)
                )
            )
        data = dict(
            org=org,
            scope=scope,
            foreign_scope=foreign_scope,
            metric=metric,
            foreign_metric=foreign_metric,
            action=action,
            user=user,
            outsider=outsider,
            password=password,
            member_login=member_login,
            admin=admin,
        )
        try:
            yield data
        finally:
            admin.execute("delete from public.orgs where org_id=%s", (org,))
            admin.execute(
                "delete from auth.users where id=any(%s)", ([user, outsider],)
            )
            admin.execute(sql.SQL("drop role {}").format(sql.Identifier(member_login)))
            for role in ("causent_recompute_worker", "causent_resolve_worker"):
                admin.execute(
                    sql.SQL("alter role {} nologin password null").format(
                        sql.Identifier(role)
                    )
                )


@contextlib.contextmanager
def login(f, role, actor=None):
    options = conninfo_to_dict(DSN)
    options.update(user=role, password=f["password"])
    with psycopg.connect(make_conninfo(**options)) as conn:
        conn.execute("set local role authenticated")
        conn.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (json.dumps({"sub": str(actor or f["user"]), "role": "authenticated"}),),
        )
        yield conn


def evaluate(f, role="causent_recompute_worker"):
    with login(f, role) as conn:
        persist_metric_readouts(conn, f["scope"], f["metric"], commit=False)
    return (
        f["admin"]
        .execute(
            "select edge_id, evaluation_id from public.current_edge_readouts where scope_id=%s and action_id=%s",
            (f["scope"], f["action"]),
        )
        .fetchone()
    )


def test_real_worker_logins_create_scoped_manifest_and_coherent_evidence(fixture):
    f = fixture
    for role in ("causent_recompute_worker", "causent_resolve_worker"):
        edge, run = evaluate(f, role)
        record = (
            f["admin"]
            .execute(
                "select actor_id,input_manifest,input_hash,model_version from public.evaluation_runs where evaluation_id=%s",
                (run,),
            )
            .fetchone()
        )
        assert record[0] == f["user"]
        assert len(record[1]["observations"]) == 120
        assert record[1]["actions"][0][0] == str(f["action"])
        assert len(record[2]) == 64 and record[3].startswith("its:")
        assert (
            f["admin"]
            .execute(
                "select count(distinct methodology) from public.evidence_objects where edge_id=%s and evaluation_id=%s",
                (edge, run),
            )
            .fetchone()[0]
            == 2
        )


def test_member_cannot_mint_evaluations_even_with_forged_claims(fixture):
    f = fixture
    with (
        pytest.raises(errors.InsufficientPrivilege),
        login(f, f["member_login"]) as conn,
    ):
        conn.execute("select set_config('causent.computed_writer','true',true)")
        conn.execute(
            "insert into public.evaluation_runs(scope_id,metric_id,actor_id,input_manifest,input_hash,model_version) values (%s,%s,%s,'{}',%s,'forged')",
            (f["scope"], f["metric"], f["user"], "0" * 64),
        )


def test_member_cannot_insert_engine_evidence_or_relabel_computed_edge(fixture):
    f = fixture
    edge, run = evaluate(f)
    for method in ("ITS", "BEFORE_AFTER_14D"):
        with (
            pytest.raises(errors.InsufficientPrivilege),
            login(f, f["member_login"]) as conn,
        ):
            conn.execute(
                "insert into public.evidence_objects(scope_id,edge_id,action_id,methodology,evaluation_id) values (%s,%s,%s,%s,%s)",
                (f["scope"], edge, f["action"], method, run),
            )
    for assignments in (
        "direction='NEGATIVE'",
        "belief_score=1",
        "authoritative_method='MANUAL',evaluation_id=null",
    ):
        with (
            pytest.raises(errors.InsufficientPrivilege),
            login(f, f["member_login"]) as conn,
        ):
            conn.execute(
                sql.SQL("update public.causal_edges set {} where edge_id=%s").format(
                    sql.SQL(assignments)
                ),
                (edge,),
            )
    with (
        pytest.raises(errors.InsufficientPrivilege),
        login(f, f["member_login"]) as conn,
    ):
        conn.execute("set local role causent_recompute_worker")


def test_manual_assertions_remain_scoped_and_do_not_drive_computed_readouts(fixture):
    f = fixture
    edge, run = evaluate(f)
    before = (
        f["admin"]
        .execute(
            "select lift,belief_score,evaluation_id from public.current_edge_readouts where edge_id=%s",
            (edge,),
        )
        .fetchone()
    )
    with login(f, f["member_login"]) as conn:
        conn.execute(
            "insert into public.evidence_objects(scope_id,edge_id,action_id,methodology,lift) values (%s,%s,%s,'MANUAL',9999)",
            (f["scope"], edge, f["action"]),
        )
    assert (
        f["admin"]
        .execute(
            "select lift,belief_score,evaluation_id from public.current_edge_readouts where edge_id=%s",
            (edge,),
        )
        .fetchone()
        == before
    )
    with pytest.raises(errors.CheckViolation), login(f, f["member_login"]) as conn:
        conn.execute(
            "insert into public.evidence_objects(scope_id,edge_id,action_id,methodology,evaluation_id) values (%s,%s,%s,'MANUAL',%s)",
            (f["scope"], edge, f["action"], run),
        )
    with pytest.raises(errors.CheckViolation), login(f, f["member_login"]) as conn:
        conn.execute(
            "insert into public.evidence_objects(scope_id,edge_id,action_id,methodology) values (%s,%s,%s,'MANUAL')",
            (f["foreign_scope"], edge, f["action"]),
        )


def test_worker_actor_rls_and_metric_scope_are_still_required(fixture):
    f = fixture
    with login(f, "causent_recompute_worker", f["outsider"]) as conn:
        assert (
            conn.execute(
                "select count(*) from public.evaluation_runs where scope_id=%s",
                (f["scope"],),
            ).fetchone()[0]
            == 0
        )
    with (
        pytest.raises(errors.InsufficientPrivilege),
        login(f, "causent_recompute_worker") as conn,
    ):
        conn.execute(
            "insert into public.evaluation_runs(scope_id,metric_id,actor_id,input_manifest,input_hash,model_version) values (%s,%s,%s,'{}',%s,'test')",
            (f["scope"], f["foreign_metric"], f["user"], "0" * 64),
        )
    with login(f, f["member_login"]) as conn:
        assert (
            conn.execute(
                "select count(*) from public.current_edge_readouts where scope_id=%s",
                (f["foreign_scope"],),
            ).fetchone()[0]
            == 0
        )


def test_node_identity_and_evaluation_history_are_immutable(fixture):
    f = fixture
    edge, run = evaluate(f)
    with (
        pytest.raises(errors.ObjectNotInPrerequisiteState),
        login(f, f["member_login"]) as conn,
    ):
        conn.execute(
            "update public.nodes set semantic_ref=%s where node_id=(select source_node_id from public.causal_edges where edge_id=%s)",
            (uuid4(), edge),
        )
    with (
        pytest.raises(errors.InsufficientPrivilege),
        login(f, f["member_login"]) as conn,
    ):
        conn.execute(
            "update public.evaluation_runs set model_version='forged' where evaluation_id=%s",
            (run,),
        )
    with pytest.raises(errors.ObjectNotInPrerequisiteState):
        f["admin"].execute(
            "update public.evaluation_runs set model_version='changed' where evaluation_id=%s",
            (run,),
        )


def test_equal_timestamps_and_old_evidence_cannot_mix_current_result(fixture):
    f = fixture
    edge, old_run = evaluate(f)
    _, run = evaluate(f)
    with login(f, "causent_recompute_worker") as conn:
        conn.execute(
            "update public.causal_edges set direction='NEGATIVE',belief_score=0.5 where edge_id=%s",
            (edge,),
        )
        with conn.cursor() as cur:
            cur.executemany(
                "insert into public.evidence_objects(evidence_id,scope_id,edge_id,action_id,methodology,lift,ci_low,ci_high,created_at) values (%s,%s,%s,%s,'ITS',%s,%s,%s,'2099-01-01')",
                [
                    (
                        f"eeee0000-0000-0000-0000-{i:012d}",
                        f["scope"],
                        edge,
                        f["action"],
                        -i,
                        -i - 1,
                        -i + 1,
                    )
                    for i in range(1, 1502)
                ],
            )
        conn.execute(
            "update public.causal_edges set direction='POSITIVE',belief_score=1 where edge_id=%s",
            (edge,),
        )
    row = (
        f["admin"]
        .execute(
            "select direction,belief_score,lift,ci_low,ci_high,evaluation_id,provenance from public.current_edge_readouts where edge_id=%s",
            (edge,),
        )
        .fetchone()
    )
    assert row == ("NEGATIVE", 0.5, -1501.0, -1502.0, -1500.0, run, "computed")
    assert (
        f["admin"]
        .execute(
            "select count(*) from public.evidence_objects where evaluation_id=%s",
            (old_run,),
        )
        .fetchone()[0]
        >= 2
    )
    _, next_run = evaluate(f)
    row = (
        f["admin"]
        .execute(
            "select evaluation_id,lift from public.current_edge_readouts where edge_id=%s",
            (edge,),
        )
        .fetchone()
    )
    assert row[0] == next_run and row[1] != -1501


def action_row(f, number, repository=100):
    return dict(
        scope_id=str(f["scope"]),
        source="github_pr",
        external_ref=f"github:repo:id:{repository}:pr:{number}",
        ship_ts="2026-05-01T00:00:00Z",
        effective_date="2026-05-01",
        status="merged",
        rationale_richtext={
            "type": "doc",
            "title": f"PR {number}",
            "meta": {"source_url": f"https://github.com/acme/app/pull/{number}"},
        },
    )


def ingest(rows, barrier=None):
    with psycopg.connect(DSN) as conn:
        conn.execute("set local role service_role")
        if barrier:
            barrier.wait(timeout=10)
        return conn.execute(
            "select * from public.ingest_github_actions_v1(%s)", (Jsonb(rows),)
        ).fetchone()


def test_overlapping_batches_preserve_fresh_rows_and_exact_counts(fixture):
    f = fixture
    assert ingest([action_row(f, 1)]) == (1, 0, 0)
    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        tasks = [
            pool.submit(
                ingest, [action_row(f, 1), action_row(f, 2), action_row(f, 3)], barrier
            ),
            pool.submit(
                ingest, [action_row(f, 2), action_row(f, 4), action_row(f, 4)], barrier
            ),
        ]
        results = [task.result() for task in tasks]
    assert tuple(map(sum, zip(*results))) == (3, 3, 0)
    assert ingest([action_row(f, i) for i in range(1, 5)]) == (0, 4, 0)
    assert ingest([action_row(f, 1, repository=200)]) == (1, 0, 0)


def test_unrelated_unique_failure_rolls_back_the_entire_import(fixture):
    f = fixture
    scope = f["scope"]
    f["admin"].execute(
        sql.SQL(
            "create unique index t04_unrelated_test on public.actions((rationale_richtext->>'title')) where scope_id={} and external_ref in ('github:repo:id:100:pr:50','github:repo:id:100:pr:51')"
        ).format(sql.Literal(scope))
    )
    try:
        rows = [action_row(f, 50), action_row(f, 51)]
        rows[1]["rationale_richtext"]["title"] = rows[0]["rationale_richtext"]["title"]
        with pytest.raises(errors.UniqueViolation):
            ingest(rows)
        assert (
            f["admin"]
            .execute(
                "select count(*) from public.actions where scope_id=%s and external_ref=any(%s)",
                (scope, [r["external_ref"] for r in rows]),
            )
            .fetchone()[0]
            == 0
        )
    finally:
        f["admin"].execute("drop index t04_unrelated_test")


def test_legacy_alias_reconciliation_preserves_uuid_and_reports_collisions(fixture):
    f = fixture
    action = uuid4()
    url = "https://github.com/acme/original/pull/42"
    f["admin"].execute(
        "insert into public.actions(action_id,scope_id,source,external_ref,rationale_richtext) values (%s,%s,'github_pr','github:pr:42',%s)",
        (action, f["scope"], Jsonb({"meta": {"source_url": url}})),
    )
    f["admin"].execute(
        "insert into public.action_identity_aliases(scope_id,alias,action_id,source_url) values (%s,'github:pr:42',%s,%s)",
        (f["scope"], action, url),
    )
    with pytest.raises(errors.InvalidParameterValue):
        ingest([action_row(f, 42)])
    with psycopg.connect(DSN) as conn:
        conn.execute("set local role service_role")
        conn.execute(
            "select public.reconcile_github_identity_v1(%s,%s,%s,%s)",
            (f["scope"], action, "github:repo:id:100:pr:42", url),
        )
    assert ingest([action_row(f, 42), action_row(f, 42, 200)]) == (1, 1, 0)
    alias = (
        f["admin"]
        .execute(
            "select action_id,resolution,canonical_ref from public.action_identity_aliases where scope_id=%s and alias='github:pr:42'",
            (f["scope"],),
        )
        .fetchone()
    )
    assert alias == (action, "verified", "github:repo:id:100:pr:42")
    # A different legacy UUID must not absorb an already-canonical history.
    collision = uuid4()
    collision_url = "https://github.com/acme/app/pull/1"
    f["admin"].execute(
        "insert into public.actions(action_id,scope_id,source,external_ref,rationale_richtext) values (%s,%s,'github_pr','github:pr:1',%s)",
        (collision, f["scope"], Jsonb({"meta": {"source_url": collision_url}})),
    )
    with pytest.raises(errors.UniqueViolation), psycopg.connect(DSN) as conn:
        conn.execute("set local role service_role")
        conn.execute(
            "select public.reconcile_github_identity_v1(%s,%s,%s,%s)",
            (f["scope"], collision, "github:repo:id:100:pr:1", collision_url),
        )
    assert (
        f["admin"]
        .execute(
            "select external_ref from public.actions where action_id=%s", (collision,)
        )
        .fetchone()[0]
        == "github:pr:1"
    )

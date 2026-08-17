"""Queue, materialization, retry, and RLS gates for current prediction drift."""

from __future__ import annotations

import contextlib
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import numpy as np
import psycopg
import pytest

import persistence.drift_materialization as materialization
from persistence.drift_materialization import (
    DriftInputSnapshot,
    canonical_drift_input_hash,
    process_next_drift_refresh_job,
)
from persistence.run_drift_refresh import require_local_database

DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

ORG = uuid.UUID("d71f0000-0000-0000-0000-0000000000a1")
PROJECT = uuid.UUID("d71f0000-0000-0000-0000-0000000000a2")
SCOPE = uuid.UUID("d71f0000-0000-0000-0000-0000000000a3")
OWNER = uuid.UUID("d71f0000-0000-0000-0000-0000000000a4")
VIEWER = uuid.UUID("d71f0000-0000-0000-0000-0000000000a5")

FOREIGN_ORG = uuid.UUID("d71f0000-0000-0000-0000-0000000000b1")
FOREIGN_PROJECT = uuid.UUID("d71f0000-0000-0000-0000-0000000000b2")
FOREIGN_SCOPE = uuid.UUID("d71f0000-0000-0000-0000-0000000000b3")
FOREIGN_OWNER = uuid.UUID("d71f0000-0000-0000-0000-0000000000b4")

METRIC = uuid.UUID("d71f0000-0000-0000-0000-0000000000c1")
ACTION = uuid.UUID("d71f0000-0000-0000-0000-0000000000d1")
DECISION = uuid.UUID("d71f0000-0000-0000-0000-0000000000e1")
PREDICTION = uuid.UUID("d71f0000-0000-0000-0000-0000000000f1")

SERIES_START = date(2025, 1, 1)
SERIES_DAYS = 120


def _connect() -> psycopg.Connection:
    conn = psycopg.connect(DSN)
    conn.autocommit = False
    return conn


@contextlib.contextmanager
def as_user(user_id: uuid.UUID):
    conn = _connect()
    try:
        conn.execute("set role authenticated")
        claims = json.dumps({"sub": str(user_id), "role": "authenticated"})
        conn.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
        yield conn
    finally:
        conn.close()


def _teardown(conn: psycopg.Connection) -> None:
    conn.execute(
        "delete from public.orgs where org_id = any(%s)",
        ([ORG, FOREIGN_ORG],),
    )
    conn.execute(
        "delete from auth.users where id = any(%s)",
        ([OWNER, VIEWER, FOREIGN_OWNER],),
    )
    conn.commit()


def _seed(conn: psycopg.Connection) -> None:
    _teardown(conn)
    conn.execute(
        "insert into auth.users (id) values (%s), (%s), (%s)",
        (OWNER, VIEWER, FOREIGN_OWNER),
    )
    conn.execute(
        "insert into public.orgs (org_id, name) values (%s, 'DRIFT'), (%s, 'FOREIGN')",
        (ORG, FOREIGN_ORG),
    )
    conn.execute(
        "insert into public.projects (project_id, org_id, name) "
        "values (%s, %s, 'p'), (%s, %s, 'p')",
        (PROJECT, ORG, FOREIGN_PROJECT, FOREIGN_ORG),
    )
    conn.execute(
        "insert into public.workspaces (workspace_id, project_id, name) "
        "values (%s, %s, 'w'), (%s, %s, 'w')",
        (SCOPE, PROJECT, FOREIGN_SCOPE, FOREIGN_PROJECT),
    )
    conn.execute(
        "insert into public.memberships (user_id, org_id, role) values "
        "(%s, %s, 'owner'), (%s, %s, 'viewer'), (%s, %s, 'owner')",
        (OWNER, ORG, VIEWER, ORG, FOREIGN_OWNER, FOREIGN_ORG),
    )
    conn.execute(
        "insert into public.metrics (metric_id, scope_id, name, source, unit) "
        "values (%s, %s, 'Activation', 'csv', 'percent')",
        (METRIC, SCOPE),
    )
    rng = np.random.default_rng(91)
    values = 20.0 + rng.normal(0.0, 0.3, SERIES_DAYS)
    values[60:] -= 8.0
    with conn.cursor() as cursor:
        cursor.executemany(
            "insert into public.metric_observations (metric_id, obs_date, value) "
            "values (%s, %s, %s)",
            [
                (
                    METRIC,
                    SERIES_START + timedelta(days=index),
                    round(float(value), 4),
                )
                for index, value in enumerate(values)
            ],
        )
    conn.execute(
        "insert into public.actions "
        "(action_id, scope_id, source, external_ref, status) "
        "values (%s, %s, 'manual', 'drift-plan', 'open')",
        (ACTION, SCOPE),
    )
    conn.execute(
        "insert into public.decisions (decision_id, scope_id, title, created_by) "
        "values (%s, %s, 'Improve activation', %s)",
        (DECISION, SCOPE, OWNER),
    )
    conn.execute(
        "insert into public.levers "
        "(scope_id, decision_id, action_id, metric_id, provenance_token, "
        "target_source, status) values (%s, %s, %s, %s, 'drift-materialization', "
        "'manual', 'DETECTED')",
        (SCOPE, DECISION, ACTION, METRIC),
    )
    conn.execute(
        "insert into public.predictions "
        "(prediction_id, scope_id, decision_id, metric_id, direction, "
        "magnitude_pct_mean, resolution_date, committed_at, committed_by) "
        "values (%s, %s, %s, %s, 'POSITIVE', 5, %s, %s, %s)",
        (
            PREDICTION,
            SCOPE,
            DECISION,
            METRIC,
            SERIES_START + timedelta(days=400),
            datetime.combine(SERIES_START, datetime.min.time(), tzinfo=timezone.utc),
            OWNER,
        ),
    )
    conn.commit()


@pytest.fixture()
def seeded():
    try:
        conn = _connect()
    except psycopg.OperationalError:
        pytest.skip("local Supabase is unavailable")
    try:
        try:
            _seed(conn)
        except psycopg.errors.UndefinedTable:
            conn.rollback()
            pytest.skip("drift materialization migration is unavailable")
        yield conn
    finally:
        conn.rollback()
        _teardown(conn)
        conn.close()


def test_input_hash_is_stable_and_changes_with_each_input_family():
    base = DriftInputSnapshot(
        predictions=[("p", "d", "m", "2025-01-01T00:00:00+00:00")],
        observations=[("m", "2025-01-01", 20)],
        levers=[("l", "d", "m", "a", "DETECTED", None)],
        package_interventions=[
            ("p", "activation", "support-action", "2025-03-01", "a" * 64)
        ],
    )
    assert canonical_drift_input_hash(base) == canonical_drift_input_hash(base)
    assert canonical_drift_input_hash(base) != canonical_drift_input_hash(
        DriftInputSnapshot(
            base.predictions,
            [("m", "2025-01-01", 19)],
            base.levers,
            base.package_interventions,
        )
    )
    assert canonical_drift_input_hash(base) != canonical_drift_input_hash(
        DriftInputSnapshot(
            [],
            base.observations,
            base.levers,
            base.package_interventions,
        )
    )
    assert canonical_drift_input_hash(base) != canonical_drift_input_hash(
        DriftInputSnapshot(
            base.predictions,
            base.observations,
            [],
            base.package_interventions,
        )
    )
    assert canonical_drift_input_hash(base) != canonical_drift_input_hash(
        DriftInputSnapshot(
            base.predictions,
            base.observations,
            base.levers,
            [("p", "activation", "support-action", "2025-03-02", "b" * 64)],
        )
    )


def test_local_runner_refuses_non_loopback_database():
    assert require_local_database(DSN) == DSN
    with pytest.raises(ValueError, match="loopback"):
        require_local_database("postgresql://worker.example/postgres")


def test_worker_materializes_one_current_generation_and_viewers_read_only_own_scope(seeded):
    result = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert result is not None and result.status == "PROCESSED"

    row = seeded.execute(
        "select detector_status, computed_generation from public.current_prediction_drift "
        "where prediction_id = %s and scope_id = %s",
        (PREDICTION, SCOPE),
    ).fetchone()
    assert row is not None and row[0] == "FIRED" and row[1] == result.generation

    for user_id in (OWNER, VIEWER):
        with as_user(user_id) as conn:
            direct = conn.execute(
                "select detector_status from public.current_prediction_drift "
                "where scope_id = %s",
                (SCOPE,),
            ).fetchall()
            assert direct == [("FIRED",)]
            rpc = conn.execute(
                "select refresh_status, detector_status, requested_generation, "
                "processed_generation, computed_at "
                "from public.get_current_prediction_drift_v1(%s)",
                (SCOPE,),
            ).fetchone()
            assert rpc is not None
            assert rpc[:4] == ("current", "FIRED", result.generation, result.generation)
            assert rpc[4] is not None

    with as_user(FOREIGN_OWNER) as conn:
        assert conn.execute(
            "select prediction_id from public.current_prediction_drift "
            "where scope_id = %s",
            (SCOPE,),
        ).fetchall() == []
        conn.execute("savepoint forbidden_rpc")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "select * from public.get_current_prediction_drift_v1(%s)",
                (SCOPE,),
            ).fetchall()
        conn.execute("rollback to savepoint forbidden_rpc")


def test_source_change_invalidates_then_retry_recovers_without_duplicates(
    seeded,
    monkeypatch,
):
    first = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert first is not None and first.status == "PROCESSED"

    seeded.execute(
        "update public.metric_observations set value = value + 1 "
        "where metric_id = %s and obs_date = %s",
        (METRIC, SERIES_START + timedelta(days=119)),
    )
    seeded.commit()
    assert seeded.execute(
        "select count(*) from public.current_prediction_drift where scope_id = %s",
        (SCOPE,),
    ).fetchone()[0] == 0

    with as_user(VIEWER) as conn:
        queued = conn.execute(
            "select refresh_status, detector_status, computed_at, next_attempt_at "
            "from public.get_current_prediction_drift_v1(%s)",
            (SCOPE,),
        ).fetchone()
        assert queued is not None
        assert queued[0] == "queued" and queued[1] is None and queued[2] is None
        assert queued[3] is not None

    original = materialization.read_scope_drift
    monkeypatch.setattr(
        materialization,
        "read_scope_drift",
        lambda *_: (_ for _ in ()).throw(RuntimeError("sensitive detail")),
    )
    failed = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert failed is not None and failed.status == "RETRY_SCHEDULED"
    assert failed.detail == "RuntimeError"

    with as_user(VIEWER) as conn:
        retrying = conn.execute(
            "select refresh_status, detector_status from "
            "public.get_current_prediction_drift_v1(%s)",
            (SCOPE,),
        ).fetchone()
        assert retrying == ("retrying", None)

    monkeypatch.setattr(materialization, "read_scope_drift", original)
    seeded.execute(
        "update private.drift_refresh_jobs set next_attempt_at = now() where scope_id = %s",
        (SCOPE,),
    )
    seeded.commit()
    recovered = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert recovered is not None and recovered.status == "PROCESSED"
    assert recovered.generation > first.generation

    # An exact duplicate enqueue invalidates the old fact and converges back to
    # the same single projection row; no append-only duplicate can accumulate.
    seeded.execute(
        "select private.enqueue_drift_refresh(%s, 'exact_retry')",
        (SCOPE,),
    )
    seeded.commit()
    retry = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert retry is not None and retry.status == "PROCESSED"
    assert seeded.execute(
        "select count(*) from public.current_prediction_drift where scope_id = %s",
        (SCOPE,),
    ).fetchone()[0] == 1


def test_new_generation_during_compute_supersedes_old_lease_without_blocking_source(
    seeded,
    monkeypatch,
):
    original = materialization.read_scope_drift

    def enqueue_new_generation(conn, scope_id):
        writer = _connect()
        try:
            writer.execute(
                "update public.metric_observations set value = value + 0.5 "
                "where metric_id = %s and obs_date = %s",
                (METRIC, SERIES_START + timedelta(days=118)),
            )
            writer.commit()
        finally:
            writer.close()
        return original(conn, scope_id)

    monkeypatch.setattr(
        materialization,
        "read_scope_drift",
        enqueue_new_generation,
    )
    stale = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert stale is not None and stale.status == "SUPERSEDED"
    assert seeded.execute(
        "select count(*) from public.current_prediction_drift where scope_id = %s",
        (SCOPE,),
    ).fetchone()[0] == 0

    monkeypatch.setattr(materialization, "read_scope_drift", original)
    current = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert current is not None and current.status == "PROCESSED"
    assert current.generation > stale.generation


def test_expired_final_lease_fails_closed_until_a_new_generation(seeded):
    seeded.execute(
        "update private.drift_refresh_jobs "
        "set attempts = %s, claimed_generation = requested_generation, "
        "lease_token = %s, lease_expires_at = now() - interval '1 second' "
        "where scope_id = %s",
        (materialization.MAX_ATTEMPTS, uuid.uuid4(), SCOPE),
    )
    seeded.commit()

    failed = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert failed is not None
    assert failed.status == "FAILED"
    assert failed.detail == "LEASE_EXPIRED"
    assert seeded.execute(
        "select processed_generation = requested_generation, attempts, "
        "last_error_code, lease_token from private.drift_refresh_jobs "
        "where scope_id = %s",
        (SCOPE,),
    ).fetchone() == (True, materialization.MAX_ATTEMPTS, "LEASE_EXPIRED", None)

    with as_user(VIEWER) as conn:
        assert conn.execute(
            "select refresh_status, detector_status from "
            "public.get_current_prediction_drift_v1(%s)",
            (SCOPE,),
        ).fetchone() == ("failed", None)

    seeded.execute(
        "select private.enqueue_drift_refresh(%s, 'new_source_generation')",
        (SCOPE,),
    )
    seeded.commit()
    recovered = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert recovered is not None and recovered.status == "PROCESSED"


def test_authenticated_writes_and_cross_scope_forgery_fail_closed(seeded):
    process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    with as_user(OWNER) as conn:
        conn.execute("savepoint no_write")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "update public.current_prediction_drift set reason = 'forged' "
                "where prediction_id = %s",
                (PREDICTION,),
            )
        conn.execute("rollback to savepoint no_write")

    seeded.execute("savepoint cross_scope")
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        seeded.execute(
            "update public.current_prediction_drift set scope_id = %s "
            "where prediction_id = %s",
            (FOREIGN_SCOPE, PREDICTION),
        )
    seeded.execute("rollback to savepoint cross_scope")


def test_resolved_prediction_is_removed_from_current_projection(seeded):
    process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    seeded.execute(
        "update public.predictions set resolved_at = now(), "
        "resolved_verdict = 'INCONCLUSIVE' where prediction_id = %s",
        (PREDICTION,),
    )
    seeded.commit()
    result = process_next_drift_refresh_job(seeded, scope_id=SCOPE)
    assert result is not None and result.status == "PROCESSED"
    assert seeded.execute(
        "select count(*) from public.current_prediction_drift where scope_id = %s",
        (SCOPE,),
    ).fetchone()[0] == 0
    with as_user(VIEWER) as conn:
        assert conn.execute(
            "select * from public.get_current_prediction_drift_v1(%s)",
            (SCOPE,),
        ).fetchall() == []

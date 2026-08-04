"""Live queue/worker gate: coalescing, hash idempotency, RLS and stale pointers."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from threading import Event, Thread

import psycopg
import pytest

import persistence.recompute as recompute
from persistence.recompute import process_next_recompute_job

DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

ORG = uuid.UUID("a1000000-0000-0000-0000-000000000001")
PROJECT = uuid.UUID("a1000000-0000-0000-0000-000000000002")
SCOPE = uuid.UUID("a1000000-0000-0000-0000-000000000003")
ACTOR = uuid.UUID("a1000000-0000-0000-0000-000000000004")
FOREIGN_ACTOR = uuid.UUID("a1000000-0000-0000-0000-000000000005")
METRIC = uuid.UUID("a1000000-0000-0000-0000-000000000006")
SERIES = uuid.UUID("a1000000-0000-0000-0000-000000000007")
REPORT = uuid.UUID("a1000000-0000-0000-0000-000000000008")
REVISION = uuid.UUID("a1000000-0000-0000-0000-000000000009")
DECISION = uuid.UUID("a1000000-0000-0000-0000-000000000010")
PREDICTION = uuid.UUID("a1000000-0000-0000-0000-000000000011")
ACTION = uuid.UUID("a1000000-0000-0000-0000-000000000012")
UNRELATED_ACTION = uuid.UUID("a1000000-0000-0000-0000-000000000013")
ACTIVATION = uuid.UUID("a1000000-0000-0000-0000-000000000014")


def _connect() -> psycopg.Connection:
    conn = psycopg.connect(DSN)
    conn.autocommit = False
    return conn


def _teardown(conn: psycopg.Connection) -> None:
    conn.execute("delete from public.orgs where org_id = %s", (ORG,))
    conn.execute("delete from auth.users where id = any(%s)", ([ACTOR, FOREIGN_ACTOR],))
    conn.commit()


def _seed(conn: psycopg.Connection) -> None:
    _teardown(conn)
    conn.execute("insert into auth.users (id) values (%s), (%s)", (ACTOR, FOREIGN_ACTOR))
    conn.execute("insert into public.orgs (org_id, name) values (%s, 'RECOMPUTE')", (ORG,))
    conn.execute(
        "insert into public.projects (project_id, org_id, name) values (%s, %s, 'p')",
        (PROJECT, ORG),
    )
    conn.execute(
        "insert into public.workspaces (workspace_id, project_id, name) values (%s, %s, 'w')",
        (SCOPE, PROJECT),
    )
    conn.execute(
        "insert into public.memberships (user_id, org_id, role) values (%s, %s, 'owner')",
        (ACTOR, ORG),
    )
    conn.execute(
        "insert into public.metrics (metric_id, scope_id, name, source, granularity) "
        "values (%s, %s, 'Activation', 'csv', 'daily')",
        (METRIC, SCOPE),
    )
    start = date(2026, 1, 1)
    values = [100.0 + (35.0 if index >= 50 else 0.0) for index in range(120)]
    with conn.cursor() as cursor:
        cursor.executemany(
            "insert into public.metric_observations (metric_id, obs_date, value) values (%s, %s, %s)",
            [(METRIC, start + timedelta(days=index), value) for index, value in enumerate(values)],
        )
    conn.execute(
        "insert into public.decision_report_series (series_id, scope_id) values (%s, %s)",
        (SERIES, SCOPE),
    )
    conn.execute(
        "insert into public.decision_reports "
        "(report_id, scope_id, title, status, series_id, iteration_number, created_by) "
        "values (%s, %s, 'Current report', 'report_ready', %s, 1, %s)",
        (REPORT, SCOPE, SERIES, ACTOR),
    )
    conn.execute(
        "insert into public.decision_report_revisions "
        "(revision_id, report_id, scope_id, revision_number, schema_version, snapshot, "
        "metric_projection, content_hash, authored_by) "
        "values (%s, %s, %s, 1, 1, '{}'::jsonb, '{}'::jsonb, %s, %s)",
        (REVISION, REPORT, SCOPE, "a" * 32, ACTOR),
    )
    conn.execute(
        "update public.decision_reports set current_revision_id = %s, reviewed_revision_id = %s "
        "where report_id = %s",
        (REVISION, REVISION, REPORT),
    )
    conn.execute(
        "insert into public.decisions (decision_id, scope_id, title, created_by) "
        "values (%s, %s, 'Ship', %s)",
        (DECISION, SCOPE, ACTOR),
    )
    with conn.cursor() as cursor:
        cursor.executemany(
            "insert into public.actions "
            "(action_id, scope_id, source, external_ref, effective_date, status, rationale_richtext) "
            "values (%s, %s, 'manual', %s, %s, 'complete', %s::jsonb)",
            [
                (ACTION, SCOPE, "current", start + timedelta(days=50),
                 '{"meta":{"source":"decision_report","source_item_id":"a"}}'),
                (UNRELATED_ACTION, SCOPE, "historical", start + timedelta(days=55),
                 '{"meta":{"source":"decision_report","source_item_id":"old"}}'),
            ],
        )
    conn.execute(
        "insert into public.decision_actions (decision_id, action_id) values (%s, %s)",
        (DECISION, ACTION),
    )
    conn.execute(
        "insert into public.predictions "
        "(prediction_id, scope_id, decision_id, metric_id, direction, magnitude_pct_mean, "
        "resolution_date, committed_by) values (%s, %s, %s, %s, 'POSITIVE', 10, %s, %s)",
        (PREDICTION, SCOPE, DECISION, METRIC, date(2099, 1, 1), ACTOR),
    )
    conn.execute(
        "insert into public.decision_report_activations "
        "(activation_id, report_id, revision_id, scope_id, input_hash, metric_id, "
        "prediction_direction, prediction_magnitude_pct_mean, prediction_resolution_date, "
        "selected_action_source_ids, decision_id, prediction_id, action_ids, "
        "primary_lever_source_id, primary_lever_action_id, activated_by) "
        "values (%s, %s, %s, %s, %s, %s, 'POSITIVE', 10, %s, array['a'], %s, %s, "
        "array[%s]::uuid[], 'a', %s, %s)",
        (
            ACTIVATION, REPORT, REVISION, SCOPE, "b" * 32, METRIC,
            date(2099, 1, 1), DECISION, PREDICTION, ACTION, ACTION, ACTOR,
        ),
    )
    conn.execute(
        "insert into public.levers "
        "(scope_id, decision_id, action_id, metric_id, provenance_token, target_source, status) "
        "values (%s, %s, %s, %s, 'recompute-primary', 'manual', 'SHIPPED')",
        (SCOPE, DECISION, ACTION, METRIC),
    )
    conn.execute(
        "update public.decision_reports set status = 'active', active_activation_id = %s, "
        "active_decision_id = %s, active_prediction_id = %s, active_metric_id = %s, "
        "activated_by = %s, activated_at = now() where report_id = %s",
        (ACTIVATION, DECISION, PREDICTION, METRIC, ACTOR, REPORT),
    )
    conn.execute(
        "select private.enqueue_current_causal_recompute(%s, %s, 'test_seed', %s)",
        (SCOPE, METRIC, ACTOR),
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
            pytest.skip("causal recompute migration is unavailable")
        yield conn
    finally:
        conn.rollback()
        _teardown(conn)
        conn.close()


def _evidence_counts(conn: psycopg.Connection) -> tuple[int, int]:
    current = conn.execute(
        "select count(*) from public.evidence_objects where action_id = %s", (ACTION,)
    ).fetchone()[0]
    unrelated = conn.execute(
        "select count(*) from public.evidence_objects where action_id = %s",
        (UNRELATED_ACTION,),
    ).fetchone()[0]
    return current, unrelated


def test_worker_is_exact_retry_safe_current_action_only_and_supersedes_stale_pointer(seeded):
    first = process_next_recompute_job(seeded, scope_id=SCOPE, metric_id=METRIC)
    assert first is not None and first.status == "PROCESSED"
    assert _evidence_counts(seeded) == (2, 0)

    seeded.execute(
        "select private.enqueue_current_causal_recompute(%s, %s, 'exact_retry', %s)",
        (SCOPE, METRIC, ACTOR),
    )
    seeded.commit()
    retry = process_next_recompute_job(seeded, scope_id=SCOPE, metric_id=METRIC)
    assert retry is not None and retry.status == "UNCHANGED"
    assert _evidence_counts(seeded) == (2, 0)

    seeded.execute(
        "update public.metric_observations set value = value + 1 "
        "where metric_id = %s and obs_date = date '2026-04-30'",
        (METRIC,),
    )
    seeded.commit()
    changed = process_next_recompute_job(seeded, scope_id=SCOPE, metric_id=METRIC)
    assert changed is not None and changed.status == "PROCESSED"
    assert _evidence_counts(seeded) == (4, 0)

    seeded.execute(
        "select private.enqueue_current_causal_recompute(%s, %s, 'stale_pointer', %s)",
        (SCOPE, METRIC, ACTOR),
    )
    seeded.execute(
        "update public.decision_report_series set current_active_report_id = null "
        "where series_id = %s",
        (SERIES,),
    )
    seeded.commit()
    stale = process_next_recompute_job(seeded, scope_id=SCOPE, metric_id=METRIC)
    assert stale is not None and stale.status == "SUPERSEDED"
    assert _evidence_counts(seeded) == (4, 0)


def test_worker_runs_graph_io_as_stored_actor_and_fails_closed_for_forgery(seeded):
    seeded.execute(
        "update public.metric_observations set value = value + 2 "
        "where metric_id = %s and obs_date = date '2026-04-29'",
        (METRIC,),
    )
    # Simulate a corrupted/forged queued identity only after the legitimate
    # observation trigger has enqueued the generation as the activation actor.
    seeded.execute(
        "update private.causal_recompute_jobs set requested_by = %s where activation_id = %s",
        (FOREIGN_ACTOR, ACTIVATION),
    )
    seeded.commit()
    result = process_next_recompute_job(seeded, scope_id=SCOPE, metric_id=METRIC)
    assert result is not None and result.status == "RETRY_SCHEDULED"
    assert _evidence_counts(seeded) == (0, 0)


def test_worker_locks_current_pointer_spine_until_graph_receipt_commits(
    seeded, monkeypatch
):
    """A successor/pointer move cannot make the target historical mid-write.

    The worker locks report -> series -> workspace -> activation, matching the
    activation path's report-first update and series/workspace pointer trigger.
    This test attempts the series move only after the bridge has been entered,
    proving that all target locks remain held through the receipt commit.
    """
    bridge_entered = Event()
    release_bridge = Event()
    move_started = Event()
    move_finished = Event()
    worker_result = []
    failures = []

    def blocking_bridge(*_args, **kwargs):
        assert kwargs == {"action_ids": [ACTION], "commit": False}
        bridge_entered.set()
        assert release_bridge.wait(5), "test did not release the bridge"

    monkeypatch.setattr(recompute, "persist_metric_readouts", blocking_bridge)

    def run_worker():
        conn = _connect()
        try:
            worker_result.append(
                process_next_recompute_job(conn, scope_id=SCOPE, metric_id=METRIC)
            )
        except Exception as exc:  # pragma: no cover - assertion reports thread faults
            failures.append(exc)
        finally:
            conn.close()

    def move_pointer():
        conn = _connect()
        try:
            move_started.set()
            conn.execute(
                "update public.decision_report_series "
                "set current_active_report_id = null where series_id = %s",
                (SERIES,),
            )
            conn.commit()
            move_finished.set()
        except Exception as exc:  # pragma: no cover - assertion reports thread faults
            failures.append(exc)
            conn.rollback()
        finally:
            conn.close()

    worker_thread = Thread(target=run_worker)
    mover_thread = Thread(target=move_pointer)
    worker_thread.start()
    try:
        assert bridge_entered.wait(5)
        mover_thread.start()
        assert move_started.wait(5)
        assert not move_finished.wait(0.25), "pointer move bypassed worker row locks"
    finally:
        release_bridge.set()
    worker_thread.join(5)
    mover_thread.join(5)

    assert not worker_thread.is_alive()
    assert not mover_thread.is_alive()
    assert failures == []
    assert len(worker_result) == 1
    assert worker_result[0] is not None and worker_result[0].status == "PROCESSED"
    assert move_finished.is_set()


class _RollbackGateConnection:
    """Expose the old full-rollback race deterministically if it regresses."""

    def __init__(self, conn: psycopg.Connection, enqueue_finished: Event):
        self._conn = conn
        self._enqueue_finished = enqueue_finished

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def rollback(self):
        self._conn.rollback()
        # The removed implementation released its job lock here. Waiting for the
        # newer enqueue makes its subsequent unguarded failure update overwrite
        # that generation, so this test fails deterministically on the old code.
        assert self._enqueue_finished.wait(5), "new generation did not enqueue"


def test_failed_worker_keeps_job_lock_until_newer_generation_can_enqueue(
    seeded, monkeypatch
):
    # psycopg Connection.execute returns the cursor; keep this explicit so the
    # fixture connection is out of a transaction before the threaded race.
    initial_generation = seeded.execute(
        "select requested_generation from private.causal_recompute_jobs "
        "where activation_id = %s",
        (ACTIVATION,),
    ).fetchone()[0]
    seeded.commit()

    bridge_entered = Event()
    release_bridge = Event()
    enqueue_started = Event()
    enqueue_finished = Event()
    worker_result = []
    failures = []

    def failing_bridge(*_args, **_kwargs):
        bridge_entered.set()
        assert release_bridge.wait(5), "test did not release the failing bridge"
        raise ValueError("synthetic bridge failure")

    monkeypatch.setattr(recompute, "persist_metric_readouts", failing_bridge)

    def run_worker():
        raw = _connect()
        conn = _RollbackGateConnection(raw, enqueue_finished)
        try:
            worker_result.append(
                process_next_recompute_job(conn, scope_id=SCOPE, metric_id=METRIC)
            )
        except Exception as exc:  # pragma: no cover - assertion reports thread faults
            failures.append(exc)
        finally:
            raw.close()

    def enqueue_new_generation():
        conn = _connect()
        try:
            enqueue_started.set()
            conn.execute(
                "select private.enqueue_current_causal_recompute(%s, %s, %s, %s)",
                (SCOPE, METRIC, "newer_generation", ACTOR),
            )
            conn.commit()
            enqueue_finished.set()
        except Exception as exc:  # pragma: no cover - assertion reports thread faults
            failures.append(exc)
            conn.rollback()
        finally:
            conn.close()

    worker_thread = Thread(target=run_worker)
    enqueue_thread = Thread(target=enqueue_new_generation)
    worker_thread.start()
    try:
        assert bridge_entered.wait(5)
        enqueue_thread.start()
        assert enqueue_started.wait(5)
        assert not enqueue_finished.wait(0.25), "enqueue bypassed the claimed job lock"
    finally:
        release_bridge.set()
    worker_thread.join(5)
    enqueue_thread.join(5)

    assert not worker_thread.is_alive()
    assert not enqueue_thread.is_alive()
    assert failures == []
    assert len(worker_result) == 1
    assert worker_result[0] is not None
    assert worker_result[0].status == "RETRY_SCHEDULED"
    assert worker_result[0].generation == initial_generation

    generation, processed, attempts, error = seeded.execute(
        "select requested_generation, processed_generation, attempts, last_error_code "
        "from private.causal_recompute_jobs where activation_id = %s",
        (ACTIVATION,),
    ).fetchone()
    assert generation == initial_generation + 1
    assert processed < generation
    assert attempts == 0
    assert error is None


def test_public_status_is_current_pointer_bound_sanitized_and_access_checked(seeded):
    def status_for(conn: psycopg.Connection, actor: uuid.UUID):
        conn.execute("set local role authenticated")
        conn.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (f'{{"sub":"{actor}","role":"authenticated"}}',),
        )
        return conn.execute(
            "select status, requested_at, last_processed_at, next_attempt_at "
            "from public.get_current_causal_recompute_status_v1(%s)",
            (SCOPE,),
        ).fetchone()

    queued = status_for(seeded, ACTOR)
    assert queued is not None
    assert queued[0] == "queued"
    assert queued[1] is not None
    assert queued[2] is None
    assert queued[3] is not None
    seeded.rollback()

    processed = process_next_recompute_job(seeded, scope_id=SCOPE, metric_id=METRIC)
    assert processed is not None and processed.status == "PROCESSED"
    current = status_for(seeded, ACTOR)
    assert current is not None
    assert current[0] == "current"
    assert current[2] is not None
    assert current[3] is None
    seeded.rollback()

    foreign = _connect()
    try:
        with pytest.raises(
            psycopg.errors.InsufficientPrivilege,
            match="Workspace not found or unavailable",
        ):
            status_for(foreign, FOREIGN_ACTOR)
    finally:
        foreign.rollback()
        foreign.close()

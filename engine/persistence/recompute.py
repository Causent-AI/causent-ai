"""Transactional worker for current Decision Report causal recomputation.

The database owns both targeting and coalescing. A job is keyed by immutable
activation and carries a monotonically increasing requested generation. This
worker locks one job, resolves the workspace's explicit current pointer again,
then runs the persistence bridge under the stored actor's RLS identity. Graph
writes and the processed-generation receipt commit together.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, replace
from time import perf_counter
from datetime import timedelta
from uuid import UUID

from psycopg import Connection

from persistence.bridge import persist_metric_readouts
from persistence.measurement import load_measurement_input, runtime_identity

MAX_ATTEMPTS = 8
MAX_BATCH = 20


@dataclass(frozen=True)
class RecomputeResult:
    activation_id: UUID
    generation: int
    status: str
    detail: str
    timings_ms: dict[str, float] | None = None


@dataclass(frozen=True)
class _ClaimedJob:
    activation_id: UUID
    scope_id: UUID
    report_id: UUID
    metric_id: UUID
    generation: int
    attempts: int
    last_input_hash: str | None
    requested_by: UUID | None


@dataclass(frozen=True)
class _ResolvedTarget:
    action_ids: list[UUID]
    actor_id: UUID
    package_context: dict[str, object] | None


def canonical_input_hash(
    *,
    activation_id: object,
    report_id: object,
    metric_id: object,
    action_ids: list[object],
    observations: list[tuple[object, object]],
    actions: list[tuple[object, object, object, object, object]],
    lever_rows: list[tuple[object, object, object]],
    package_context: dict[str, object] | None = None,
) -> str:
    """Stable SHA-256 over every bridge-relevant current-activation input."""

    def normalized(value: object) -> object:
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        if hasattr(value, "isoformat"):
            return value.isoformat()  # date/datetime
        return str(value)

    payload = {
        "runtime": runtime_identity(),
        "activation_id": str(activation_id),
        "report_id": str(report_id),
        "metric_id": str(metric_id),
        "action_ids": [str(action_id) for action_id in action_ids],
        "observations": [
            [normalized(obs_date), normalized(value)] for obs_date, value in observations
        ],
        "actions": [[normalized(value) for value in row] for row in actions],
        "levers": [[normalized(value) for value in row] for row in lever_rows],
        "package_context": None if package_context is None else {
            key: normalized(value) if not isinstance(value, list)
            else [normalized(item) for item in value]
            for key, value in package_context.items()
        },
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _claim_job(
    conn: Connection,
    *,
    scope_id: UUID | str | None,
    metric_id: UUID | str | None,
) -> _ClaimedJob | None:
    filters = [
        "processed_generation < requested_generation",
        "next_attempt_at <= now()",
    ]
    params: list[object] = []
    if scope_id is not None:
        filters.append("scope_id = %s")
        params.append(scope_id)
    if metric_id is not None:
        filters.append("metric_id = %s")
        params.append(metric_id)
    row = conn.execute(
        "select activation_id, scope_id, report_id, metric_id, "
        "requested_generation, attempts, last_input_hash, requested_by "
        "from private.causal_recompute_jobs where "
        + " and ".join(filters)
        + " order by next_attempt_at, requested_at, activation_id "
        "for update skip locked limit 1",
        params,
    ).fetchone()
    if row is None:
        return None
    return _ClaimedJob(*row)


def _resolve_current_target(conn: Connection, job: _ClaimedJob) -> _ResolvedTarget | None:
    """Lock and return the current activation target + stored member actor, or stale.

    The explicit report -> series -> workspace order mirrors activation's
    report-first transition and its pointer trigger. Holding all four target
    rows until the generation receipt commits prevents successor activation or
    deletion from making this report historical while graph writes are landing.
    """
    report = conn.execute(
        "select series_id, active_activation_id "
        "from public.decision_reports "
        "where report_id = %s and scope_id = %s and status = 'active' "
        "and deleted_at is null and active_metric_id = %s "
        "for update",
        (job.report_id, job.scope_id, job.metric_id),
    ).fetchone()
    if report is None:
        return None

    series_id, active_activation_id = report
    if active_activation_id != job.activation_id:
        return None

    series = conn.execute(
        "select series_id from public.decision_report_series "
        "where series_id = %s and scope_id = %s and current_active_report_id = %s "
        "for update",
        (series_id, job.scope_id, job.report_id),
    ).fetchone()
    if series is None:
        return None

    workspace = conn.execute(
        "select project_id from public.workspaces "
        "where workspace_id = %s and archived_at is null and current_decision_report_series_id = %s "
        "for update",
        (job.scope_id, series_id),
    ).fetchone()
    if workspace is None:
        return None

    activation = conn.execute(
        "select action_ids, activated_by, contract_version, primary_lever_action_id "
        "from public.decision_report_activations "
        "where activation_id = %s and report_id = %s and scope_id = %s "
        "and metric_id = %s for update",
        (job.activation_id, job.report_id, job.scope_id, job.metric_id),
    ).fetchone()
    if activation is None:
        return None

    action_ids, activated_by, contract_version, registered_primary_action_id = activation
    package_context: dict[str, object] | None = None
    target_action_ids = list(action_ids)
    if contract_version == 2:
        if registered_primary_action_id not in action_ids:
            raise RuntimeError("DECISION_PACKAGE_CONTRACT_MISMATCH")
        # Completion remains execution history. Only the registered plan and
        # observed exposure may supply measurement timing.
        target_action_ids = [registered_primary_action_id]
        package_context = {"included_action_ids": list(action_ids),
                           "registered_primary_action_id": registered_primary_action_id}
    actor_id = job.requested_by or activated_by
    if actor_id is None:
        actor = conn.execute(
            "select membership.user_id "
            "from public.projects project "
            "join public.memberships membership on membership.org_id = project.org_id "
            "where project.project_id = %s "
            "and membership.role in ('owner','admin','member') "
            "order by case membership.role when 'owner' then 1 when 'admin' then 2 else 3 end, "
            "membership.user_id limit 1",
            (workspace[0],),
        ).fetchone()
        actor_id = actor[0] if actor is not None else None
    if actor_id is None:
        raise RuntimeError("MISSING_STORED_ACTOR")
    return _ResolvedTarget(target_action_ids, actor_id, package_context)


def _load_input_hash(
    conn: Connection,
    job: _ClaimedJob,
    action_ids: list[UUID],
    package_context: dict[str, object] | None = None,
) -> str:
    return load_measurement_input(conn, job.scope_id, job.metric_id,
                                  job.activation_id, action_ids).input_hash


def _set_actor(conn: Connection, actor_id: UUID) -> None:
    conn.execute("set local role authenticated")
    claims = json.dumps({"sub": str(actor_id), "role": "authenticated"})
    conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))


def _finish(
    conn: Connection,
    job: _ClaimedJob,
    *,
    input_hash: str | None,
    error_code: str | None,
    resume_at=None,
) -> None:
    conn.execute("reset role")
    conn.execute(
        "update private.causal_recompute_jobs "
        "set processed_generation = %s, attempts = 0, last_input_hash = coalesce(%s, last_input_hash), "
        "last_processed_at = now(), last_error_code = %s "
        "where activation_id = %s",
        (job.generation, input_hash, error_code, job.activation_id),
    )
    if resume_at is not None:
        conn.execute(
            "update private.causal_recompute_jobs set requested_generation=requested_generation+1, "
            "next_attempt_at=(%s::date::timestamp at time zone 'UTC') where activation_id=%s",
            (resume_at, job.activation_id),
        )
    conn.commit()


def _record_failure(conn: Connection, job: _ClaimedJob, exc: Exception) -> RecomputeResult:
    conn.execute("reset role")
    next_attempt = job.attempts + 1
    code = type(exc).__name__[:80]
    if next_attempt >= MAX_ATTEMPTS:
        updated = conn.execute(
            "update private.causal_recompute_jobs set processed_generation = %s, "
            "attempts = %s, last_processed_at = now(), last_error_code = %s "
            "where activation_id = %s and requested_generation = %s "
            "and processed_generation < %s",
            (
                job.generation,
                MAX_ATTEMPTS,
                code,
                job.activation_id,
                job.generation,
                job.generation,
            ),
        )
        if updated.rowcount != 1:
            conn.rollback()
            raise RuntimeError("RECOMPUTE_JOB_GENERATION_CHANGED")
        conn.commit()
        return RecomputeResult(job.activation_id, job.generation, "FAILED", code)

    delay = timedelta(seconds=min(1800, 5 * (2 ** min(job.attempts, 8))))
    updated = conn.execute(
        "update private.causal_recompute_jobs set attempts = %s, "
        "next_attempt_at = now() + %s, last_error_code = %s "
        "where activation_id = %s and requested_generation = %s "
        "and processed_generation < %s",
        (
            next_attempt,
            delay,
            code,
            job.activation_id,
            job.generation,
            job.generation,
        ),
    )
    if updated.rowcount != 1:
        conn.rollback()
        raise RuntimeError("RECOMPUTE_JOB_GENERATION_CHANGED")
    conn.commit()
    return RecomputeResult(job.activation_id, job.generation, "RETRY_SCHEDULED", code)


def process_next_recompute_job(
    conn: Connection,
    *,
    scope_id: UUID | str | None = None,
    metric_id: UUID | str | None = None,
) -> RecomputeResult | None:
    """Process atomically and expose bounded phase timings without source data."""
    timings: dict[str, float] = {}
    started = perf_counter()
    result = _process_next_recompute_job(conn, scope_id=scope_id, metric_id=metric_id, timings=timings)
    if result is None:
        return None
    timings["total"] = round((perf_counter() - started) * 1000, 3)
    # Includes Python return/receipt overhead after commit: an upper bound, not
    # a claim that pg_locks was sampled continuously.
    timings["post_claim"] = round(max(0, timings["total"] - timings["claim"]), 3)
    timings["lock_held_upper"] = timings["total"]
    logger = logging.getLogger("causent.recompute")
    log = logger.warning if timings["lock_held_upper"] >= 1000 else logger.info
    log(json.dumps({"event": "recompute_timing", "status": result.status, "timings_ms": timings}))
    return replace(result, timings_ms=timings)


def _process_next_recompute_job(conn: Connection, *, scope_id, metric_id, timings: dict[str, float]) -> RecomputeResult | None:
    """Lock and process one eligible generation on ``conn``."""
    phase = perf_counter()
    conn.execute("reset role")
    job = _claim_job(conn, scope_id=scope_id, metric_id=metric_id)
    timings["claim"] = round((perf_counter() - phase) * 1000, 3)
    if job is None:
        conn.rollback()
        return None
    # The job lock predates this savepoint and therefore survives a work rollback.
    # A failed bridge can record its receipt without opening a window in which a
    # newer enqueue generation acquires the row and is then overwritten.
    conn.execute("savepoint causal_recompute_work")
    try:
        phase = perf_counter()
        target = _resolve_current_target(conn, job)
        timings["target"] = round((perf_counter() - phase) * 1000, 3)
        if target is None:
            _finish(conn, job, input_hash=None, error_code="SUPERSEDED_POINTER")
            return RecomputeResult(
                job.activation_id, job.generation, "SUPERSEDED", "current pointer moved"
            )
        _set_actor(conn, target.actor_id)
        phase = perf_counter()
        measurement = load_measurement_input(
            conn, job.scope_id, job.metric_id, job.activation_id, target.action_ids
        )
        timings["input"] = round((perf_counter() - phase) * 1000, 3)
        input_hash = measurement.input_hash
        if input_hash == job.last_input_hash:
            _finish(
                conn,
                job,
                input_hash=input_hash,
                error_code=None,
                resume_at=measurement.resume_at,
            )
            return RecomputeResult(
                job.activation_id,
                job.generation,
                "UNCHANGED",
                "input hash already processed",
            )

        phase = perf_counter()
        persist_metric_readouts(
            conn,
            job.scope_id,
            job.metric_id,
            action_ids=target.action_ids,
            activation_id=job.activation_id,
            commit=False,
        )
        timings["analysis_and_write"] = round((perf_counter() - phase) * 1000, 3)
        _finish(
            conn,
            job,
            input_hash=input_hash,
            error_code=None,
            resume_at=measurement.resume_at,
        )
        return RecomputeResult(
            job.activation_id, job.generation, "PROCESSED", "graph materialized"
        )
    except Exception as exc:  # the failure receipt intentionally stores only the class
        conn.execute("rollback to savepoint causal_recompute_work")
        conn.execute("release savepoint causal_recompute_work")
        return _record_failure(conn, job, exc)


def drain_recompute_jobs(
    conn: Connection,
    *,
    limit: int = 10,
    scope_id: UUID | str | None = None,
    metric_id: UUID | str | None = None,
) -> list[RecomputeResult]:
    """Process up to ``limit`` jobs, stopping when no due generation remains."""
    bounded_limit = max(1, min(int(limit), MAX_BATCH))
    results: list[RecomputeResult] = []
    for _ in range(bounded_limit):
        result = process_next_recompute_job(
            conn, scope_id=scope_id, metric_id=metric_id
        )
        if result is None:
            break
        results.append(result)
    return results

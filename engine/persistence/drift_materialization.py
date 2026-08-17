"""Durable worker for the current baseline-drift projection.

Source-table triggers coalesce work per workspace in
``private.drift_refresh_jobs``. A worker leases one requested generation, runs
the existing ``causal.drift`` detector over a repeatable-read snapshot, then
replaces the workspace projection only if a short compare-and-swap still sees
that exact generation.

The dashboard never calls this module. Hosted/local workers use a privileged
connection, so every input and output query carries the claimed ``scope_id``
explicitly; a malformed cross-workspace prediction fails the whole generation
closed instead of publishing a partial result.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from psycopg import Connection

from causal.types import DriftResult
from persistence.drift_read import read_scope_drift

MAX_ATTEMPTS = 8
MAX_BATCH = 20
LEASE_SECONDS = 360


@dataclass(frozen=True)
class DriftRefreshResult:
    scope_id: UUID
    generation: int
    status: str
    detail: str


@dataclass(frozen=True)
class _ClaimedJob:
    scope_id: UUID
    generation: int
    attempts: int
    lease_token: UUID


@dataclass(frozen=True)
class DriftInputSnapshot:
    predictions: list[tuple[object, ...]]
    observations: list[tuple[object, ...]]
    levers: list[tuple[object, ...]]
    package_interventions: list[tuple[object, ...]] = field(default_factory=list)


def _normalized(value: object) -> object:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()  # date/datetime
    return str(value)


def canonical_drift_input_hash(snapshot: DriftInputSnapshot) -> str:
    """Stable SHA-256 over every input used by ``detect_baseline_drift``."""
    payload = {
        "predictions": [
            [_normalized(value) for value in row] for row in snapshot.predictions
        ],
        "observations": [
            [_normalized(value) for value in row] for row in snapshot.observations
        ],
        "levers": [[_normalized(value) for value in row] for row in snapshot.levers],
        "package_interventions": [
            [_normalized(value) for value in row]
            for row in snapshot.package_interventions
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _load_input_snapshot(conn: Connection, scope_id: UUID) -> DriftInputSnapshot:
    predictions = conn.execute(
        "select prediction.prediction_id, prediction.decision_id, "
        "prediction.metric_id, prediction.committed_at "
        "from public.predictions as prediction "
        "where prediction.scope_id = %s and prediction.resolved_at is null "
        "order by prediction.prediction_id",
        (scope_id,),
    ).fetchall()
    metric_ids = sorted({row[2] for row in predictions}, key=str)
    observations: list[tuple[object, ...]] = []
    if metric_ids:
        observations = conn.execute(
            "select metric.metric_id, observation.obs_date, observation.value "
            "from public.metrics as metric "
            "join public.metric_observations as observation "
            "on observation.metric_id = metric.metric_id "
            "where metric.scope_id = %s and metric.metric_id = any(%s) "
            "order by metric.metric_id, observation.obs_date",
            (scope_id, metric_ids),
        ).fetchall()
    levers = conn.execute(
        "select distinct lever.lever_id, lever.decision_id, lever.metric_id, "
        "lever.action_id, lever.status, action.effective_date "
        "from public.levers as lever "
        "join public.actions as action "
        "on action.action_id = lever.action_id and action.scope_id = lever.scope_id "
        "join public.predictions as prediction "
        "on prediction.decision_id = lever.decision_id "
        "and prediction.metric_id = lever.metric_id "
        "and prediction.scope_id = lever.scope_id "
        "and prediction.resolved_at is null "
        "where lever.scope_id = %s "
        "order by lever.lever_id",
        (scope_id,),
    ).fetchall()
    package_interventions = conn.execute(
        "select activation.prediction_id, package.activation_id, "
        "package.intervention_action_id, package.intervention_date, "
        "package.package_hash "
        "from public.workspaces as workspace "
        "join public.decision_report_series as series "
        "on series.series_id = workspace.current_decision_report_series_id "
        "and series.scope_id = workspace.workspace_id "
        "join public.decision_reports as report "
        "on report.report_id = series.current_active_report_id "
        "and report.series_id = series.series_id "
        "and report.scope_id = workspace.workspace_id "
        "join public.decision_report_activations as activation "
        "on activation.activation_id = report.active_activation_id "
        "and activation.report_id = report.report_id "
        "and activation.scope_id = report.scope_id "
        "join public.decision_report_package_interventions as package "
        "on package.activation_id = activation.activation_id "
        "and package.scope_id = activation.scope_id "
        "join public.predictions as prediction "
        "on prediction.prediction_id = activation.prediction_id "
        "and prediction.scope_id = activation.scope_id "
        "and prediction.resolved_at is null "
        "where workspace.workspace_id = %s "
        "and report.status = 'active' and report.deleted_at is null "
        "and activation.contract_version = 2 "
        "order by activation.prediction_id",
        (scope_id,),
    ).fetchall()
    return DriftInputSnapshot(
        predictions,
        observations,
        levers,
        package_interventions,
    )


def _claim_job(
    conn: Connection,
    *,
    scope_id: UUID | str | None,
) -> _ClaimedJob | None:
    filters = [
        "processed_generation < requested_generation",
        "next_attempt_at <= now()",
        "attempts < %s",
    ]
    params: list[object] = [MAX_ATTEMPTS]
    if scope_id is not None:
        filters.append("scope_id = %s")
        params.append(scope_id)
    filters.append("(lease_token is null or lease_expires_at <= now())")
    row = conn.execute(
        "select scope_id, requested_generation, attempts "
        "from private.drift_refresh_jobs where "
        + " and ".join(filters)
        + " order by next_attempt_at, requested_at, scope_id "
        "for update skip locked limit 1",
        params,
    ).fetchone()
    if row is None:
        conn.rollback()
        return None
    claimed_scope_id, generation, previous_attempts = row
    lease_token = uuid4()
    updated = conn.execute(
        "update private.drift_refresh_jobs "
        "set attempts = attempts + 1, "
        "claimed_generation = requested_generation, lease_token = %s, "
        "lease_expires_at = now() + make_interval(secs => %s) "
        "where scope_id = %s and requested_generation = %s "
        "and processed_generation < %s",
        (
            lease_token,
            LEASE_SECONDS,
            claimed_scope_id,
            generation,
            generation,
        ),
    )
    if updated.rowcount != 1:
        conn.rollback()
        return None
    conn.commit()
    return _ClaimedJob(
        claimed_scope_id,
        generation,
        previous_attempts + 1,
        lease_token,
    )


def _finalize_exhausted_job(
    conn: Connection,
    *,
    scope_id: UUID | str | None,
) -> DriftRefreshResult | None:
    """Fail one due generation whose final worker lease expired.

    Every lease acquisition counts as an attempt, so process termination and
    platform timeouts cannot retry forever without executing the Python
    exception path. A later source write requests a new generation and resets
    this terminal state through ``enqueue_drift_refresh``.
    """
    filters = [
        "processed_generation < requested_generation",
        "next_attempt_at <= now()",
        "attempts >= %s",
        "(lease_token is null or lease_expires_at <= now())",
    ]
    params: list[object] = [MAX_ATTEMPTS]
    if scope_id is not None:
        filters.append("scope_id = %s")
        params.append(scope_id)
    row = conn.execute(
        "select scope_id, requested_generation "
        "from private.drift_refresh_jobs where "
        + " and ".join(filters)
        + " order by next_attempt_at, requested_at, scope_id "
        "for update skip locked limit 1",
        params,
    ).fetchone()
    if row is None:
        return None
    exhausted_scope_id, generation = row
    updated = conn.execute(
        "update private.drift_refresh_jobs "
        "set processed_generation = requested_generation, "
        "last_processed_at = now(), claimed_generation = null, "
        "lease_token = null, lease_expires_at = null, "
        "last_error_code = 'LEASE_EXPIRED' "
        "where scope_id = %s and requested_generation = %s "
        "and processed_generation < requested_generation and attempts >= %s",
        (exhausted_scope_id, generation, MAX_ATTEMPTS),
    )
    if updated.rowcount != 1:
        conn.rollback()
        return None
    conn.commit()
    return DriftRefreshResult(
        exhausted_scope_id,
        generation,
        "FAILED",
        "LEASE_EXPIRED",
    )


def _finite_or_none(value: float | None, field: str) -> float | None:
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise RuntimeError(f"NONFINITE_DRIFT_{field.upper()}")
    return number


def _materialized_row(
    prediction_id: str,
    drift: DriftResult,
    *,
    scope_id: UUID,
    generation: int,
    input_hash: str,
) -> tuple[object, ...]:
    shift_date = (
        date.fromordinal(drift.shift_ordinal)
        if drift.shift_ordinal is not None
        else None
    )
    return (
        UUID(prediction_id),
        scope_id,
        drift.status,
        drift.reason,
        shift_date,
        _finite_or_none(drift.pre_level, "pre_level"),
        _finite_or_none(drift.post_level, "post_level"),
        _finite_or_none(drift.delta_native, "delta_native"),
        _finite_or_none(drift.pct_change, "pct_change"),
        drift.direction,
        _finite_or_none(drift.ci_low, "ci_low"),
        _finite_or_none(drift.ci_high, "ci_high"),
        int(drift.n_pre),
        int(drift.n_post),
        generation,
        input_hash,
    )


def _replace_projection(
    conn: Connection,
    job: _ClaimedJob,
    drift_by_prediction: dict[str, DriftResult],
    *,
    snapshot: DriftInputSnapshot,
    input_hash: str,
) -> None:
    expected_ids = {str(row[0]) for row in snapshot.predictions}
    if set(drift_by_prediction) != expected_ids:
        raise RuntimeError("INCOMPLETE_WORKSPACE_DRIFT_INPUT")

    rows = [
        _materialized_row(
            prediction_id,
            drift_by_prediction[prediction_id],
            scope_id=job.scope_id,
            generation=job.generation,
            input_hash=input_hash,
        )
        for prediction_id in sorted(drift_by_prediction)
    ]

    conn.execute(
        "delete from public.current_prediction_drift where scope_id = %s",
        (job.scope_id,),
    )
    if rows:
        with conn.cursor() as cursor:
            cursor.executemany(
                "insert into public.current_prediction_drift ("
                "prediction_id, scope_id, detector_status, reason, shift_date, "
                "pre_level, post_level, delta_native, pct_change, direction, "
                "ci_low, ci_high, n_pre, n_post, computed_generation, input_hash"
                ") values ("
                "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s"
                ")",
                rows,
            )


def _publish_success(
    conn: Connection,
    job: _ClaimedJob,
    drift_by_prediction: dict[str, DriftResult],
    *,
    snapshot: DriftInputSnapshot,
    input_hash: str,
) -> bool:
    current = conn.execute(
        "select requested_generation, claimed_generation, lease_token "
        "from private.drift_refresh_jobs where scope_id = %s for update",
        (job.scope_id,),
    ).fetchone()
    if current != (job.generation, job.generation, job.lease_token):
        conn.rollback()
        return False

    _replace_projection(
        conn,
        job,
        drift_by_prediction,
        snapshot=snapshot,
        input_hash=input_hash,
    )
    updated = conn.execute(
        "update private.drift_refresh_jobs "
        "set processed_generation = %s, attempts = 0, reasons = '{}'::text[], "
        "last_input_hash = %s, last_processed_at = now(), "
        "next_attempt_at = now(), claimed_generation = null, "
        "lease_token = null, lease_expires_at = null, last_error_code = null "
        "where scope_id = %s and requested_generation = %s "
        "and claimed_generation = %s and lease_token = %s "
        "and processed_generation < %s",
        (
            job.generation,
            input_hash,
            job.scope_id,
            job.generation,
            job.generation,
            job.lease_token,
            job.generation,
        ),
    )
    if updated.rowcount != 1:
        raise RuntimeError("DRIFT_JOB_GENERATION_CHANGED")
    conn.commit()
    return True


def _record_failure(
    conn: Connection,
    job: _ClaimedJob,
    exc: Exception,
) -> DriftRefreshResult:
    error_code = type(exc).__name__[:80]
    if job.attempts >= MAX_ATTEMPTS:
        updated = conn.execute(
            "update private.drift_refresh_jobs "
            "set processed_generation = %s, attempts = %s, "
            "last_processed_at = now(), claimed_generation = null, "
            "lease_token = null, lease_expires_at = null, last_error_code = %s "
            "where scope_id = %s and requested_generation = %s "
            "and claimed_generation = %s and lease_token = %s "
            "and processed_generation < %s",
            (
                job.generation,
                MAX_ATTEMPTS,
                error_code,
                job.scope_id,
                job.generation,
                job.generation,
                job.lease_token,
                job.generation,
            ),
        )
        if updated.rowcount != 1:
            conn.rollback()
            return DriftRefreshResult(
                job.scope_id,
                job.generation,
                "SUPERSEDED",
                "newer generation requested",
            )
        conn.commit()
        return DriftRefreshResult(job.scope_id, job.generation, "FAILED", error_code)

    delay = timedelta(
        seconds=min(1800, 5 * (2 ** min(max(job.attempts - 1, 0), 8)))
    )
    updated = conn.execute(
        "update private.drift_refresh_jobs "
        "set next_attempt_at = now() + %s, last_error_code = %s, "
        "claimed_generation = null, lease_token = null, lease_expires_at = null "
        "where scope_id = %s and requested_generation = %s "
        "and claimed_generation = %s and lease_token = %s "
        "and processed_generation < %s",
        (
            delay,
            error_code,
            job.scope_id,
            job.generation,
            job.generation,
            job.lease_token,
            job.generation,
        ),
    )
    if updated.rowcount != 1:
        conn.rollback()
        return DriftRefreshResult(
            job.scope_id,
            job.generation,
            "SUPERSEDED",
            "newer generation requested",
        )
    conn.commit()
    return DriftRefreshResult(
        job.scope_id,
        job.generation,
        "RETRY_SCHEDULED",
        error_code,
    )


def process_next_drift_refresh_job(
    conn: Connection,
    *,
    scope_id: UUID | str | None = None,
) -> DriftRefreshResult | None:
    """Lock and process one due workspace generation on ``conn``."""
    conn.execute("reset role")
    exhausted = _finalize_exhausted_job(conn, scope_id=scope_id)
    if exhausted is not None:
        return exhausted
    job = _claim_job(conn, scope_id=scope_id)
    if job is None:
        return None

    try:
        # One repeatable-read snapshot keeps the input hash and every per-
        # prediction detector query coherent while source writers remain free to
        # enqueue a newer generation. This transaction performs no writes.
        conn.execute("set transaction isolation level repeatable read, read only")
        snapshot = _load_input_snapshot(conn, job.scope_id)
        input_hash = canonical_drift_input_hash(snapshot)
        drift_by_prediction = read_scope_drift(conn, job.scope_id)
        conn.commit()
    except Exception as exc:
        conn.rollback()
        return _record_failure(conn, job, exc)

    try:
        published = _publish_success(
            conn,
            job,
            drift_by_prediction,
            snapshot=snapshot,
            input_hash=input_hash,
        )
        if not published:
            return DriftRefreshResult(
                job.scope_id,
                job.generation,
                "SUPERSEDED",
                "newer generation requested",
            )
        return DriftRefreshResult(
            job.scope_id,
            job.generation,
            "PROCESSED",
            "current drift materialized",
        )
    except Exception as exc:
        conn.rollback()
        return _record_failure(conn, job, exc)


def drain_drift_refresh_jobs(
    conn: Connection,
    *,
    limit: int = 10,
    scope_id: UUID | str | None = None,
) -> list[DriftRefreshResult]:
    """Process up to ``limit`` due jobs, bounded to ``MAX_BATCH``."""
    bounded_limit = max(1, min(int(limit), MAX_BATCH))
    results: list[DriftRefreshResult] = []
    for _ in range(bounded_limit):
        result = process_next_drift_refresh_job(conn, scope_id=scope_id)
        if result is None:
            break
        results.append(result)
    return results

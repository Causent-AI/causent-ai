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
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from psycopg import Connection

from persistence.bridge import persist_metric_readouts

MAX_ATTEMPTS = 8
MAX_BATCH = 20


@dataclass(frozen=True)
class RecomputeResult:
    activation_id: UUID
    generation: int
    status: str
    detail: str


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
        "where workspace_id = %s and current_decision_report_series_id = %s "
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
        package = conn.execute(
            "select intervention_action_id, intervention_date, included_action_ids, "
            "registered_primary_action_id, package_hash, completed_at "
            "from public.decision_report_package_interventions "
            "where activation_id = %s and scope_id = %s and report_id = %s",
            (job.activation_id, job.scope_id, job.report_id),
        ).fetchone()
        # A v2 report has no valid causal breakpoint until the entire decision
        # package is complete. Pre-completion jobs are consumed without a model run.
        if package is None:
            return None
        (intervention_action_id, intervention_date, included_action_ids,
         package_primary_action_id, package_hash, completed_at) = package
        if (
            list(included_action_ids) != list(action_ids)
            or package_primary_action_id != registered_primary_action_id
            or intervention_action_id not in action_ids
        ):
            raise RuntimeError("DECISION_PACKAGE_CONTRACT_MISMATCH")
        target_action_ids = [intervention_action_id]
        package_context = {
            "causal_object": "decision_package",
            "intervention_rule": "latest_effective_included_action",
            "registered_primary_action_id": registered_primary_action_id,
            "intervention_action_id": intervention_action_id,
            "intervention_date": intervention_date,
            "included_action_ids": list(included_action_ids),
            "package_hash": package_hash,
            "completed_at": completed_at,
            "individual_attribution": False,
        }
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
    observations = conn.execute(
        "select obs_date, value from public.metric_observations "
        "where metric_id = %s order by obs_date",
        (job.metric_id,),
    ).fetchall()
    target_actions = conn.execute(
        "select action_id, source, external_ref, effective_date, status "
        "from public.actions where scope_id = %s and action_id = any(%s) "
        "order by action_id",
        (job.scope_id, action_ids),
    ).fetchall()
    if {str(row[0]) for row in target_actions} != {
        str(action_id) for action_id in action_ids
    }:
        raise RuntimeError("ACTIVATION_ACTION_SET_UNAVAILABLE")

    # The persistence bridge applies BH-FDR across every effective action in the
    # metric's observed date range before filtering outputs to this activation.
    # Hash that same family so a changed non-target hypothesis cannot be mistaken
    # for an exact retry of an older statistical result.
    family_actions: list[tuple[object, object, object, object, object]] = []
    if observations:
        family_actions = conn.execute(
            "select action_id, source, external_ref, effective_date, status "
            "from public.actions where scope_id = %s and effective_date is not null "
            "and effective_date between %s and %s order by action_id",
            (job.scope_id, observations[0][0], observations[-1][0]),
        ).fetchall()
    actions_by_id = {str(row[0]): row for row in family_actions}
    actions_by_id.update({str(row[0]): row for row in target_actions})
    actions = [actions_by_id[action_id] for action_id in sorted(actions_by_id)]
    levers = conn.execute(
        "select action_id, status, target_source from public.levers "
        "where scope_id = %s and metric_id = %s and action_id = any(%s) "
        "order by action_id, lever_id",
        (job.scope_id, job.metric_id, action_ids),
    ).fetchall()
    return canonical_input_hash(
        activation_id=job.activation_id,
        report_id=job.report_id,
        metric_id=job.metric_id,
        action_ids=action_ids,
        observations=observations,
        actions=actions,
        lever_rows=levers,
        package_context=package_context,
    )


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
) -> None:
    conn.execute("reset role")
    conn.execute(
        "update private.causal_recompute_jobs "
        "set processed_generation = %s, attempts = 0, last_input_hash = coalesce(%s, last_input_hash), "
        "last_processed_at = now(), last_error_code = %s "
        "where activation_id = %s",
        (job.generation, input_hash, error_code, job.activation_id),
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
    """Lock and process one eligible generation on ``conn``."""
    conn.execute("reset role")
    job = _claim_job(conn, scope_id=scope_id, metric_id=metric_id)
    if job is None:
        conn.rollback()
        return None
    # The job lock predates this savepoint and therefore survives a work rollback.
    # A failed bridge can record its receipt without opening a window in which a
    # newer enqueue generation acquires the row and is then overwritten.
    conn.execute("savepoint causal_recompute_work")
    try:
        target = _resolve_current_target(conn, job)
        if target is None:
            _finish(conn, job, input_hash=None, error_code="SUPERSEDED_POINTER")
            return RecomputeResult(
                job.activation_id, job.generation, "SUPERSEDED", "current pointer moved"
            )
        _set_actor(conn, target.actor_id)
        input_hash = _load_input_hash(
            conn,
            job,
            target.action_ids,
            target.package_context,
        )
        if input_hash == job.last_input_hash:
            _finish(conn, job, input_hash=input_hash, error_code=None)
            return RecomputeResult(
                job.activation_id, job.generation, "UNCHANGED", "input hash already processed"
            )

        persist_metric_readouts(
            conn,
            job.scope_id,
            job.metric_id,
            action_ids=target.action_ids,
            commit=False,
        )
        _finish(conn, job, input_hash=input_hash, error_code=None)
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

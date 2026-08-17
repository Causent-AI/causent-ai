"""Persistence inputs for the baseline-drift worker (C5/#18).

The detector (causal/drift.py) remains pure and authoritative. This module is
the thin database seam used by the asynchronous materialization worker and by
focused engine tests. Dashboard requests never import or execute it.

The pre-intervention window is derived here: `commit_ordinal` from the
prediction's committed_at. A current Decision Report v2 package uses its
audited package intervention date (the latest effective included action).
Legacy predictions use the earliest lever that has actually SHIPPED for the
(decision, metric). When neither intervention exists, drift is searched over
the whole post-commit tail. This boundary keeps the decision's own effect from
ever reading as drift (see causal/drift.py).
"""

from __future__ import annotations

from uuid import UUID

from psycopg import Connection

from causal.drift import detect_baseline_drift
from causal.types import DriftResult
from persistence.bridge import _load_metric
Id = UUID | str


def _ship_ordinal(
    conn: Connection,
    scope_id: Id,
    decision_id: Id,
    metric_id: Id,
) -> int | None:
    """The earliest SHIPPED lever's effective-date ordinal for this (decision,
    metric) — the upper bound of the pre-intervention window. None when no lever
    has shipped (unshipped / DETECTED / DROPPED), i.e. the prospective case."""
    row = conn.execute(
        "select min(action.effective_date) "
        "from public.levers as lever "
        "join public.actions as action "
        "on action.action_id = lever.action_id and action.scope_id = lever.scope_id "
        "where lever.scope_id = %s and lever.decision_id = %s "
        "and lever.metric_id = %s and lever.status = 'SHIPPED' "
        "and action.effective_date is not null",
        (scope_id, decision_id, metric_id),
    ).fetchone()
    effective_date = row[0] if row is not None else None
    return effective_date.toordinal() if effective_date is not None else None


def _package_intervention_ordinal(
    conn: Connection,
    scope_id: Id,
    prediction_id: Id,
) -> tuple[bool, int | None]:
    """The explicit current v2 package breakpoint, if the package is complete.

    Historical or stale report activations never override the legacy lever
    cutoff: the workspace and series current pointers are part of this lookup.
    """
    row = conn.execute(
        "select package.intervention_date "
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
        "left join public.decision_report_package_interventions as package "
        "on package.activation_id = activation.activation_id "
        "and package.scope_id = activation.scope_id "
        "where workspace.workspace_id = %s "
        "and report.status = 'active' and report.deleted_at is null "
        "and activation.contract_version = 2 "
        "and activation.prediction_id = %s",
        (scope_id, prediction_id),
    ).fetchone()
    if row is None:
        return False, None
    intervention_date = row[0]
    return True, (
        intervention_date.toordinal() if intervention_date is not None else None
    )


def read_prediction_drift(
    conn: Connection,
    prediction_id: Id,
    *,
    scope_id: Id | None = None,
) -> DriftResult | None:
    """Compute one prediction's baseline drift. None when the prediction is not
    visible or does not belong to the explicit worker scope."""
    pid = UUID(str(prediction_id))
    params: list[object] = [pid]
    scope_filter = ""
    if scope_id is not None:
        scope_filter = " and prediction.scope_id = %s"
        params.append(scope_id)
    row = conn.execute(
        "select prediction.scope_id, prediction.decision_id, "
        "prediction.metric_id, prediction.committed_at "
        "from public.predictions as prediction "
        "join public.decisions as decision "
        "on decision.decision_id = prediction.decision_id "
        "and decision.scope_id = prediction.scope_id "
        "join public.metrics as metric "
        "on metric.metric_id = prediction.metric_id "
        "and metric.scope_id = prediction.scope_id "
        "where prediction.prediction_id = %s" + scope_filter,
        params,
    ).fetchone()
    if row is None:
        return None
    prediction_scope_id, decision_id, metric_id, committed_at = row

    metric = _load_metric(conn, metric_id)
    if metric is None:
        # A declared metric that never received observations — no baseline to move.
        return DriftResult("NO_BASELINE_YET", reason="no_observations")

    commit_ordinal = committed_at.date().toordinal()
    is_current_package, package_intervention_ordinal = _package_intervention_ordinal(
        conn,
        prediction_scope_id,
        pid,
    )
    if is_current_package:
        ship_ordinal = package_intervention_ordinal
    else:
        ship_ordinal = _ship_ordinal(
            conn,
            prediction_scope_id,
            decision_id,
            metric_id,
        )
    # metric.series already carries the sorted ordinal dates + float values
    # (NULL -> NaN); the detector chooses its own change-point splits inside it.
    return detect_baseline_drift(metric.series, commit_ordinal, ship_ordinal)


def read_scope_drift(conn: Connection, scope_id: Id) -> dict[str, DriftResult]:
    """Baseline drift for every UNRESOLVED prediction in the scope. The notice is
    a live signal on an open belief; a resolved prediction's record already
    stands, so it is skipped. Keyed by prediction_id (str) for the read layer."""
    rows = conn.execute(
        "select prediction_id from public.predictions "
        "where scope_id = %s and resolved_at is null "
        "order by prediction_id",
        (scope_id,),
    ).fetchall()
    out: dict[str, DriftResult] = {}
    for (pid,) in rows:
        drift = read_prediction_drift(conn, pid, scope_id=scope_id)
        if drift is not None:
            out[str(pid)] = drift
    return out

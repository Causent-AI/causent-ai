"""Resolution verdict machine + scorer (epic #6, child #8).

At a prediction's `resolution_date` the live ITS engine measures the registered
causal object against its primary metric. For Decision Report v2, that object is
the complete decision package: no model runs until every included action is
complete, and the latest effective included action supplies timing without
receiving individual causal credit. Legacy predictions retain their lever
semantics. This module maps the ITS belief-table state onto one of the 8
verdicts (docs/designs/prospective-prediction-loop.md) and persists the memory
tuple. It REUSES the bridge (persist_metric_readouts) to materialize the
statistical readout through the real engine — it never re-implements ITS.

Verdict machine (belief table -> verdict):

    belief 1.0, direction matches, predicted-native in CI      CONFIRMED
    belief 1.0, direction matches, predicted-native outside CI DIRECTION_CONFIRMED
    belief 1.0, direction opposite                             REFUTED
    belief 0.0/0.5 (FDR / autocorr / CI-incl-0 / placebo)      INCONCLUSIVE
    belief NULL INSUFFICIENT / INSUFFICIENT_HISTORY            GATHERING (extend)
    belief NULL DEGENERATE                                     UNRESOLVABLE
    shipped-lever span > MAX_CLUSTER_SPAN_DAYS                 UNRESOLVABLE
    no lever shipped by resolution date (unshipped/DROPPED)    VOIDED
    prediction with no mapped lever                            UNATTRIBUTED
    declared metric with no observations                       UNMEASURABLE_NO_METRIC

Multi-lever (C4/#17): a prediction's effect on one metric can be carried by
several levers. ONE shipped lever resolves exactly as before (single-
intervention ITS on the lever edge). SEVERAL shipped levers resolve via the
existing cluster overlay — the levers form a cluster measured as ONE
intervention at the earliest ship date, and the prediction resolves against
the CLUSTER -> METRIC edge's belief. If the ships span more than
MAX_CLUSTER_SPAN_DAYS the co-occurrence premise fails and the verdict is
UNRESOLVABLE (multi-breakpoint ITS is explicitly deferred, not attempted).
Only SHIPPED levers count toward the intervention window; unshipped and
DROPPED levers are excluded, and a prediction whose levers ALL dropped or
never shipped is VOIDED.

Units contract (store-both, score-native): the stored magnitude_pct_mean (%) is
the human commitment and stays authoritative for display. At resolution the
scorer derives predicted_native = magnitude_pct_mean/100 x pre_window_mean,
where pre_window_mean is the EXACT pre-period mean the ITS used (the n_pre
points before the intervention date) — both sides of the comparison share one
denominator, so there is no commit-vs-resolution drift. The commit-time
magnitude_native / native_denom_mean snapshot is display/audit only and is
never a scoring input.

Scoring is sign-primary + magnitude-in-CI bonus: direction must match for
CONFIRMED/DIRECTION_CONFIRMED (sign vs the measured edge direction); the in-CI
check only upgrades DIRECTION_CONFIRMED to CONFIRMED, never rescues a wrong
sign.

GATHERING auto-extends resolution_date (a not-yet is not a no) and leaves
resolved_at NULL so the runner re-measures on the next due pass. All other
verdicts are terminal: a re-run is a no-op.

Honesty rules honored here:
  - Elicit-not-assert: this module only ever MEASURES a human-authored
    prediction; nothing in it generates or pre-fills a prospective number.
  - Same-metric multi-lever resolves via the cluster overlay (a real,
    already-verified method) rather than a forced single breakpoint or an
    unproven multi-intervention fit; when even the cluster premise fails
    (ships too far apart) the honest answer is UNRESOLVABLE, not a number.
  - A declared metric that never received observations is
    UNMEASURABLE_NO_METRIC — stated plainly, never a fabricated readout.

The connection contract mirrors the bridge: `conn` must be an INJECTED,
RLS-scoped psycopg connection (the caller's identity — never the service
role). A cross-scope prediction is simply invisible and untouched.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import UUID

import numpy as np
from psycopg import Connection

from persistence.bridge import (
    persist_metric_readouts,
)

Id = UUID | str

# A GATHERING verdict bumps resolution_date this far forward — matching the
# 14-day descriptive horizon (CLUSTER_POST_WINDOW) as the natural re-check beat.
GATHERING_EXTENSION_DAYS = 14

# Ship-span guard (C4/#17): several shipped levers on one (decision, metric)
# are measured as ONE intervention via the cluster overlay — a premise that
# only holds when the ships co-occur. Beyond this span the honest verdict is
# UNRESOLVABLE (forcing one breakpoint would misdate the intervention;
# multi-breakpoint ITS is explicitly deferred). 28 days = two of the 14-day
# descriptive post-windows: a staged rollout, not two separate bets.
MAX_CLUSTER_SPAN_DAYS = int(os.environ.get("CAUSENT_MAX_CLUSTER_SPAN_DAYS", "28"))

VERDICTS = (
    "CONFIRMED",
    "DIRECTION_CONFIRMED",
    "REFUTED",
    "INCONCLUSIVE",
    "GATHERING",
    "UNRESOLVABLE",
    "VOIDED",
    "UNATTRIBUTED",
    "UNMEASURABLE_NO_METRIC",
)

TERMINAL_VERDICTS = frozenset(v for v in VERDICTS if v != "GATHERING")


@dataclass(frozen=True)
class Lever:
    action_id: UUID
    ref: str                      # display: external_ref, else source
    effective_date: date | None   # None = never shipped
    status: str = "SHIPPED"       # levers lifecycle (DRAFTED..SHIPPED/DROPPED/TIMED_OUT)


@dataclass(frozen=True)
class DecisionPackageContract:
    registered_primary_action_id: UUID
    included_action_ids: list[UUID]
    intervention_action: Lever | None = None
    package_hash: str | None = None
    completed_at: datetime | None = None


@dataclass(frozen=True)
class EdgeState:
    """The materialized belief-table state for the lever edge."""

    direction: str                # POSITIVE | NEGATIVE | INCONCLUSIVE
    belief_score: float | None
    belief_reason: str | None
    lift: float | None            # native units (ITS step coefficient)
    ci_low: float | None
    ci_high: float | None
    edge_id: UUID | None = None


@dataclass(frozen=True)
class ResolutionResult:
    prediction_id: UUID
    status: str                   # RESOLVED | GATHERING | SKIPPED_*
    verdict: str | None
    detail: str


# ---------------------------------------------------------------------------
# Pure verdict machine (unit-testable without a database).
# ---------------------------------------------------------------------------


def shipped_levers(levers: list[Lever], today: date) -> list[Lever]:
    """The levers that count toward the intervention window: status SHIPPED
    with a ship (effective) date on or before `today`. Unshipped and DROPPED
    levers are excluded. Deduped by action (two levers may point at one
    ticket); sorted by ship date so [0] is the cluster's intervention."""
    seen: set[UUID] = set()
    out: list[Lever] = []
    for lv in sorted(
        (lv for lv in levers
         if lv.status == "SHIPPED"
         and lv.effective_date is not None
         and lv.effective_date <= today),
        key=lambda lv: (lv.effective_date, str(lv.action_id)),
    ):
        if lv.action_id not in seen:
            seen.add(lv.action_id)
            out.append(lv)
    return out


def ship_span_days(shipped: list[Lever]) -> int:
    """Days between the earliest and latest lever ship. 0 for a single lever."""
    if len(shipped) < 2:
        return 0
    dates = [lv.effective_date for lv in shipped]
    return (max(dates) - min(dates)).days


def pre_verdict(levers: list[Lever], today: date) -> str | None:
    """Verdicts decidable BEFORE measuring: no lever mapped (UNATTRIBUTED), no
    lever shipped by the resolution date (VOIDED — covers all-DROPPED and
    never-shipped alike), or shipped levers too far apart for the cluster
    premise (UNRESOLVABLE). None means 'proceed to measurement'."""
    if not levers:
        return "UNATTRIBUTED"
    shipped = shipped_levers(levers, today)
    if not shipped:
        return "VOIDED"
    if ship_span_days(shipped) > MAX_CLUSTER_SPAN_DAYS:
        return "UNRESOLVABLE"
    return None


def predicted_native_value(
    magnitude_pct_mean: float, direction: str, pre_window_mean: float | None
) -> float | None:
    """The human commitment converted to native units against the ITS pre-window
    mean. Signed by the predicted direction; |mean| keeps the sign convention
    stable if a metric's pre-mean is ever negative."""
    if pre_window_mean is None or not np.isfinite(pre_window_mean):
        return None
    signed_pct = magnitude_pct_mean if direction == "POSITIVE" else -magnitude_pct_mean
    return signed_pct / 100.0 * abs(float(pre_window_mean))


def verdict_for(
    edge: EdgeState | None, predicted_direction: str, predicted_native: float | None
) -> str:
    """Map the lever edge's belief-table state to a verdict. Sign-primary: the
    in-CI bonus can only upgrade a matched direction to CONFIRMED — it never
    rescues an opposite sign, and a right-direction/wrong-size prediction is
    DIRECTION_CONFIRMED, not REFUTED."""
    if edge is None:
        # Lever shipped but no measurable edge yet (e.g. ship date beyond the
        # observed series) — not yet, which is not a no.
        return "GATHERING"
    if edge.belief_score is None:
        if edge.belief_reason == "DEGENERATE":
            return "UNRESOLVABLE"
        return "GATHERING"  # INSUFFICIENT / INSUFFICIENT_HISTORY
    if edge.belief_score < 1.0:
        return "INCONCLUSIVE"  # 0.0/0.5: FDR, autocorrelation, CI-incl-0, placebo
    if edge.direction != predicted_direction:
        return "REFUTED"
    if (
        predicted_native is not None
        and edge.ci_low is not None
        and edge.ci_high is not None
        and edge.ci_low <= predicted_native <= edge.ci_high
    ):
        return "CONFIRMED"
    return "DIRECTION_CONFIRMED"


def pre_window_mean_for(series_values: np.ndarray, split: int) -> float | None:
    """The EXACT pre-period mean the ITS used: the n_pre (= split) observations
    before the intervention. NaN-tolerant to mirror the bridge's NULL->NaN load."""
    if split <= 0:
        return None
    window = np.asarray(series_values, dtype=np.float64)[:split]
    finite = window[np.isfinite(window)]
    if finite.size == 0:
        return None
    return float(finite.mean())


# ---------------------------------------------------------------------------
# DB lookups (all through the caller's RLS-scoped connection).
# ---------------------------------------------------------------------------


def _levers_for(conn: Connection, decision_id: Id, metric_id: Id) -> list[Lever]:
    """The lever(s) for THIS PREDICTION'S METRIC: the decision's rows in
    public.levers for that metric. C1 (#14) moved the lever mark off the old
    decision_actions boolean — an action is a lever iff it has a levers row,
    and levers are metric-scoped, so the WHERE clause is the (decision, metric)
    key directly."""
    rows = conn.execute(
        "select l.action_id, coalesce(a.external_ref, a.source), a.effective_date, "
        "l.status "
        "from public.levers l "
        "join public.actions a on a.action_id = l.action_id "
        "where l.decision_id = %s and l.metric_id = %s "
        "order by a.effective_date nulls last, a.action_id",
        (decision_id, metric_id),
    ).fetchall()
    return [Lever(action_id, ref, eff, status) for action_id, ref, eff, status in rows]


def _decision_package_for_prediction(
    conn: Connection,
    prediction_id: Id,
) -> DecisionPackageContract | None:
    """Return package semantics for v2 report predictions.

    ``None`` is a legacy/non-report prediction. A v2 package always retains its
    registered primary action and exact included action set; its intervention
    fields remain null until the package is complete.
    """
    row = conn.execute(
        "select activation.contract_version, activation.primary_lever_action_id, "
        "activation.action_ids, package.registered_primary_action_id, "
        "package.intervention_action_id, package.intervention_date, "
        "package.included_action_ids, package.package_hash, package.completed_at, "
        "coalesce(action.external_ref, action.source) "
        "from public.decision_report_activations activation "
        "left join public.decision_report_package_interventions package "
        "on package.activation_id = activation.activation_id "
        "and package.scope_id = activation.scope_id "
        "left join public.actions action "
        "on action.action_id = package.intervention_action_id "
        "and action.scope_id = package.scope_id "
        "where activation.prediction_id = %s",
        (prediction_id,),
    ).fetchone()
    if row is None or row[0] != 2:
        return None
    (
        _, activation_primary_action_id, activation_action_ids,
        package_primary_action_id, intervention_action_id,
        intervention_date, included_action_ids, package_hash, completed_at,
        intervention_ref,
    ) = row
    if (
        activation_primary_action_id is None
        or activation_primary_action_id not in activation_action_ids
    ):
        raise RuntimeError("DECISION_PACKAGE_CONTRACT_MISMATCH")
    if package_primary_action_id is None:
        return DecisionPackageContract(
            registered_primary_action_id=activation_primary_action_id,
            included_action_ids=list(activation_action_ids),
        )
    if (
        intervention_action_id not in included_action_ids
        or package_primary_action_id != activation_primary_action_id
        or list(included_action_ids) != list(activation_action_ids)
        or intervention_date is None
        or not package_hash
        or completed_at is None
    ):
        raise RuntimeError("DECISION_PACKAGE_CONTRACT_MISMATCH")
    return DecisionPackageContract(
        registered_primary_action_id=activation_primary_action_id,
        included_action_ids=list(activation_action_ids),
        intervention_action=Lever(
            intervention_action_id,
            intervention_ref or "Decision package completion",
            intervention_date,
            "SHIPPED",
        ),
        package_hash=package_hash,
        completed_at=completed_at,
    )


def _load_edge_state(
    conn: Connection, scope_id: Id, source_type: str, source_ref: Id, metric_id: Id
) -> EdgeState | None:
    """The materialized <source>->METRIC edge for the lever (source_type
    'ACTION' for the single-lever path, 'CLUSTER' for the multi-lever cluster
    path), plus the latest authoritative ITS evidence row (the raw stats the
    belief was projected from)."""
    edge = conn.execute(
        "select e.edge_id, e.direction, e.belief_score, e.belief_reason "
        "from public.causal_edges e "
        "join public.nodes s on s.node_id = e.source_node_id "
        "join public.nodes t on t.node_id = e.target_node_id "
        "where e.scope_id = %s "
        "and s.type = %s and s.semantic_ref = %s "
        "and t.type = 'METRIC' and t.semantic_ref = %s",
        (scope_id, source_type, source_ref, metric_id),
    ).fetchone()
    if edge is None:
        return None
    edge_id, direction, belief_score, belief_reason = edge
    evidence = conn.execute(
        "select lift, ci_low, ci_high from public.evidence_objects "
        "where edge_id = %s and methodology = 'ITS' "
        "order by created_at desc, evidence_id desc limit 1",
        (edge_id,),
    ).fetchone()
    lift, ci_low, ci_high = evidence if evidence else (None, None, None)
    return EdgeState(
        direction=direction,
        belief_score=None if belief_score is None else float(belief_score),
        belief_reason=belief_reason,
        lift=None if lift is None else float(lift),
        ci_low=None if ci_low is None else float(ci_low),
        ci_high=None if ci_high is None else float(ci_high),
        edge_id=edge_id,
    )


def _reference_class_features(conn: Connection, decision_id: Id, metric_id: Id) -> dict:
    """The reference-class features stored with the tuple: metric name, the
    decision's action labels, and the mechanism category (from
    decisions.rationale meta, when the capture flow recorded one)."""
    metric_row = conn.execute(
        "select name from public.metrics where metric_id = %s", (metric_id,)
    ).fetchone()
    decision_row = conn.execute(
        "select title, rationale from public.decisions where decision_id = %s",
        (decision_id,),
    ).fetchone()
    labels = [
        ref
        for (ref,) in conn.execute(
            "select coalesce(a.external_ref, a.source) "
            "from public.decision_actions da "
            "join public.actions a on a.action_id = da.action_id "
            "where da.decision_id = %s order by 1",
            (decision_id,),
        ).fetchall()
    ]
    title, rationale = decision_row if decision_row else (None, None)
    mechanism = None
    if isinstance(rationale, dict):
        meta = rationale.get("meta")
        if isinstance(meta, dict):
            mechanism = meta.get("mechanism_category")
        mechanism = mechanism or rationale.get("mechanism_category")
    return {
        "metric_name": metric_row[0] if metric_row else None,
        "decision_title": title,
        "action_labels": labels,
        "mechanism_category": mechanism,
    }


# ---------------------------------------------------------------------------
# Orchestration.
# ---------------------------------------------------------------------------


def resolve_prediction(
    conn: Connection, prediction_id: Id, today: date, force: bool = False
) -> ResolutionResult:
    """Resolve one prediction: measure the lever edge through the real bridge,
    map the belief-table state to a verdict, and persist the memory tuple.

    Idempotent: an already-terminal prediction is a no-op; GATHERING re-measures.
    `force=True` resolves a not-yet-due prediction (the UI's dev "Resolve now").
    `conn` must be RLS-scoped as the caller — a foreign prediction is invisible.
    """
    pid = UUID(str(prediction_id))
    row = conn.execute(
        "select scope_id, decision_id, metric_id, direction, magnitude_pct_mean, "
        "resolution_date, resolved_verdict "
        "from public.predictions where prediction_id = %s",
        (pid,),
    ).fetchone()
    if row is None:
        return ResolutionResult(
            pid,
            "SKIPPED_NOT_VISIBLE",
            None,
            "prediction not visible under this connection's RLS scope",
        )
    (
        scope_id,
        decision_id,
        metric_id,
        predicted_direction,
        magnitude_pct_mean,
        resolution_date,
        resolved_verdict,
    ) = row

    if resolved_verdict is not None and resolved_verdict in TERMINAL_VERDICTS:
        return ResolutionResult(
            pid,
            "SKIPPED_ALREADY_RESOLVED",
            resolved_verdict,
            "terminal verdict already written; re-run is a no-op",
        )
    if not force and resolution_date > today:
        return ResolutionResult(
            pid,
            "SKIPPED_NOT_DUE",
            None,
            f"due {resolution_date.isoformat()}",
        )

    activation = conn.execute(
        "select activation_id,action_ids,primary_lever_action_id from public.decision_report_activations "
        "where prediction_id=%s and scope_id=%s and metric_id=%s",
        (pid, scope_id, metric_id),
    ).fetchone()
    if activation is None:
        legacy_levers = _levers_for(conn, decision_id, metric_id)
        metadata = conn.execute(
            "select source,exists(select 1 from public.metric_observations where metric_id=%s) from public.metrics where metric_id=%s",
            (metric_id, metric_id),
        ).fetchone()
        disposition = (
            "UNMEASURABLE_NO_METRIC"
            if metadata and metadata[0] == "declared" and not metadata[1]
            else pre_verdict(legacy_levers, today)
        )
        if disposition in ("VOIDED", "UNATTRIBUTED", "UNMEASURABLE_NO_METRIC"):
            _write_terminal(
                conn,
                pid,
                None,
                disposition,
                {
                    "verdict": disposition,
                    "interpretation": "cannot_attribute",
                    "individual_attribution": False,
                    "ai_attribution": False,
                },
            )
            conn.commit()
            return ResolutionResult(
                pid,
                "RESOLVED",
                disposition,
                "No completed, measurable registered intervention",
            )
    targets = (
        list(activation[1])
        if activation
        else [lever.action_id for lever in _levers_for(conn, decision_id, metric_id)]
    )
    inputs, evaluation_id = persist_metric_readouts(
        conn,
        scope_id,
        metric_id,
        activation_id=activation[0] if activation else None,
        action_ids=targets,
        today=today,
        commit=False,
    )
    interpretation = (
        "waiting"
        if inputs.resume_at
        else "cannot_attribute"
        if inputs.refusal
        else "observational"
    )
    verdict = (
        "GATHERING"
        if inputs.resume_at
        else "UNRESOLVABLE"
        if inputs.refusal
        else "INCONCLUSIVE"
    )
    edge = (
        _load_edge_state(conn, scope_id, "ACTION", inputs.primary_action, metric_id)
        if inputs.primary_action
        else None
    )
    plan = inputs.manifest["plan"]
    baseline = [
        float(v)
        for d, v in inputs.observations
        if v is not None and plan and d.isoformat() < plan["exposure_start"]
    ]
    denominator = sum(baseline) / len(baseline) if baseline else None
    memory_tuple = {
        "decision_id": str(decision_id),
        "metric_id": str(metric_id),
        "activation_id": str(activation[0]) if activation else None,
        "evaluation_id": str(evaluation_id),
        "input_hash": inputs.input_hash,
        "interpretation": interpretation,
        "refusal_reason": inputs.refusal,
        "estimand": "immediate_level_change",
        "individual_attribution": False,
        "ai_attribution": False,
        "predicted_direction": predicted_direction,
        "predicted_magnitude_pct": float(magnitude_pct_mean),
        "pre_window_mean": denominator,
        "measured_lift": edge.lift if edge else None,
        "measured_pct": edge.lift / abs(denominator) * 100
        if edge and edge.lift is not None and denominator
        else None,
        "ci_low": edge.ci_low if edge else None,
        "ci_high": edge.ci_high if edge else None,
        "belief_reason": edge.belief_reason if edge else None,
        "verdict": verdict,
        "exposure_start": plan["exposure_start"] if plan else None,
        "window_end": plan["window_end"] if plan else None,
    }
    edge_id = edge.edge_id if edge else None
    if inputs.resume_at:
        conn.execute(
            "update public.predictions set resolved_verdict='GATHERING',resolution_date=%s, "
            "resolved_edge_id=%s,resolution_tuple=%s where prediction_id=%s",
            (inputs.resume_at, edge_id, json.dumps(memory_tuple), pid),
        )
    else:
        _write_terminal(conn, pid, edge_id, verdict, memory_tuple)
    conn.commit()
    return ResolutionResult(
        pid,
        "GATHERING" if inputs.resume_at else "RESOLVED",
        verdict,
        inputs.refusal
        or "Observational change only; work and AI attribution are unidentified",
    )


def _write_terminal(
    conn: Connection, prediction_id: UUID, edge_id: UUID | None,
    verdict: str, memory_tuple: dict,
) -> None:
    resolved_at = datetime.now(timezone.utc)
    conn.execute(
        "update public.predictions set resolved_edge_id = %s, resolved_verdict = %s, "
        "resolved_at = %s, resolution_tuple = %s where prediction_id = %s",
        (
            edge_id,
            verdict,
            resolved_at,
            json.dumps({**memory_tuple, "resolved_at": resolved_at.isoformat()}),
            prediction_id,
        ),
    )


def resolve_due_predictions(
    conn: Connection, scope_id: Id, today: date
) -> list[ResolutionResult]:
    """Resolve every due prediction in the scope: unresolved rows plus GATHERING
    rows whose extended date has arrived (resolved_at stays NULL until terminal)."""
    rows = conn.execute(
        "select prediction_id from public.predictions "
        "where scope_id = %s and resolved_at is null and resolution_date <= %s "
        "order by resolution_date, prediction_id",
        (scope_id, today),
    ).fetchall()
    return [resolve_prediction(conn, pid, today=today) for (pid,) in rows]

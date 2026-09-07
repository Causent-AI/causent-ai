"""Registered, fixed-horizon observational evaluation contracts.

The family is the prospectively selected primary outcome of one activation.
Historical actions are not statistical hypotheses in this family. Significance
cannot identify the effect of the work or of using AI to choose it.
"""

from __future__ import annotations

import hashlib
import json
import platform
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from causal.types import DW_CONFIDENT_MIN, FLOOR_CONFIDENT, PLACEBO_ALPHA
from psycopg import Connection

POLICY = {
    "version": "registered-observational-v1",
    "method": "segmented-ols-hac",
    "family": "registered-primary-v1",
    "estimand": "immediate_level_change",
    "q": 0.05,
    "confidence_floor": FLOOR_CONFIDENT,
    "durbin_watson_floor": DW_CONFIDENT_MIN,
    "placebo_alpha": PLACEBO_ALPHA,
    "repeated_looks": "fixed-horizon-only",
    "individual_attribution": False,
    "ai_attribution": False,
}


def runtime_identity() -> dict:
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for path in sorted((root / "causal").glob("*.py")) + sorted(
        (root / "persistence").glob("*.py")
    ):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    return {
        "policy": POLICY.copy(),
        "code_sha256": digest.hexdigest(),
        "numpy_version": np.__version__,
        "python_version": platform.python_version(),
        "architecture": platform.machine(),
        "blas": {
            key: np.__config__.CONFIG.get("Build Dependencies", {})
            .get("blas", {})
            .get(key)
            for key in ("name", "version")
        },
    }


def canonical_json(value: object) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False
    )


@dataclass(frozen=True)
class MeasurementInput:
    manifest: dict
    observations: list
    primary_action: str | None
    exposure_date: date | None
    refusal: str | None
    resume_at: date | None

    @property
    def input_hash(self) -> str:
        return hashlib.sha256(canonical_json(self.manifest).encode()).hexdigest()


def load_measurement_input(
    conn: Connection,
    scope_id,
    metric_id,
    activation_id,
    action_ids=None,
    *,
    today: date | None = None,
) -> MeasurementInput:
    today = (
        today or conn.execute("select (now() at time zone 'UTC')::date").fetchone()[0]
    )
    metric = conn.execute(
        "select scope_id from public.metrics where metric_id=%s", (metric_id,)
    ).fetchone()
    if metric is None or str(metric[0]) != str(scope_id):
        raise ValueError("Metric is unavailable in the requested workspace")
    definition_row = conn.execute(
        "select to_jsonb(d) from public.metric_definitions d where metric_id=%s and scope_id=%s",
        (metric_id, scope_id),
    ).fetchone()
    definition = definition_row[0] if definition_row else None
    activation_row = (
        None
        if activation_id is None
        else conn.execute(
            "select action_ids,primary_lever_action_id,report_id from public.decision_report_activations "
            "where activation_id=%s and scope_id=%s and metric_id=%s",
            (activation_id, scope_id, metric_id),
        ).fetchone()
    )
    if activation_id is not None and activation_row is None:
        raise ValueError("Activation is unavailable in the requested workspace")
    included = list(activation_row[0]) if activation_row else list(action_ids or [])
    primary = str(activation_row[1]) if activation_row and activation_row[1] else None
    if action_ids is not None and not {str(x) for x in action_ids}.issubset(
        {str(x) for x in included}
    ):
        raise ValueError("Requested action is outside the activation")
    actions = (
        conn.execute(
            "select action_id,source,external_ref,effective_date,status from public.actions "
            "where scope_id=%s and action_id=any(%s) order by action_id",
            (scope_id, included),
        ).fetchall()
        if included
        else []
    )
    if len(actions) != len({str(x) for x in included}):
        raise ValueError(
            "Activation actions are unavailable in the requested workspace"
        )
    plan_row = (
        None
        if activation_id is None
        else conn.execute(
            "select to_jsonb(p) from public.measurement_plans p where activation_id=%s and scope_id=%s and metric_id=%s",
            (activation_id, scope_id, metric_id),
        ).fetchone()
    )
    plan = plan_row[0] if plan_row else None
    exposure_rows = (
        []
        if plan is None
        else conn.execute(
            "select to_jsonb(e) from public.measurement_exposures e where plan_id=%s and scope_id=%s order by action_id",
            (plan["plan_id"], scope_id),
        ).fetchall()
    )
    exposures = [row[0] for row in exposure_rows]
    refusal, resume_at, exposure_date, observations = None, None, None, []
    if definition is None:
        refusal = "METRIC_DEFINITION_REQUIRED"
    elif plan is None:
        refusal = "MEASUREMENT_PLAN_REQUIRED"
    elif definition["definition_id"] != plan["definition_id"]:
        refusal = "METRIC_DEFINITION_MISMATCH"
    elif (
        plan["design"] != "observational_its"
        or plan["estimand"] != "immediate_level_change"
    ):
        refusal = "UNSUPPORTED_DESIGN"
    if plan:
        exposure_date = date.fromisoformat(plan["exposure_start"])
        full = date.fromisoformat(plan["exposure_end"])
        post_start = full + timedelta(days=plan["lag_days"])
        end = date.fromisoformat(plan["window_end"])
        observations = conn.execute(
            "select obs_date,value from public.metric_observations where metric_id=%s "
            "and obs_date between %s and %s and (obs_date<%s or obs_date>=%s) order by obs_date",
            (metric_id, plan["window_start"], end, exposure_date, post_start),
        ).fetchall()
        if refusal is None:
            if exposure_date != full:
                refusal = "STAGED_EXPOSURE_UNSUPPORTED"
            elif plan["concurrent_change_status"] != "none_known":
                refusal = "CONCURRENT_CHANGES_NOT_ISOLATED"
            elif any(
                e["first_exposure"] != plan["exposure_start"]
                or e["fully_exposed"] != plan["exposure_end"]
                for e in exposures
            ):
                refusal = "EXPOSURE_DIFFERS_FROM_PLAN"
            elif today <= end:
                refusal, resume_at = (
                    "WAITING_FOR_FIXED_HORIZON",
                    end + timedelta(days=1),
                )
            elif {e["action_id"] for e in exposures} != {str(x) for x in included}:
                refusal = "EXPOSURE_NOT_DOCUMENTED"
            elif primary is None:
                refusal = "REGISTERED_PRIMARY_REQUIRED"
            elif any(row[4] not in ("complete", "merged") for row in actions):
                refusal = "PACKAGE_INCOMPLETE"
            else:
                expected = set(
                    range(
                        date.fromisoformat(plan["window_start"]).toordinal(),
                        exposure_date.toordinal(),
                    )
                )
                expected.update(range(post_start.toordinal(), end.toordinal() + 1))
                valid = {
                    d.toordinal()
                    for d, v in observations
                    if v is not None and np.isfinite(float(v))
                }
                if valid != expected:
                    refusal = "FIXED_WINDOW_INCOMPLETE"
        # The estimand is the immediate level shift at the first eligible post
        # observation after the registered lag; baseline ends before any exposure.
        exposure_date = post_start
    manifest = {
        "contract": "registered-measurement-v1",
        "scope_id": str(scope_id),
        "metric_id": str(metric_id),
        "activation_id": str(activation_id) if activation_id else None,
        "report_id": str(activation_row[2]) if activation_row else None,
        "definition": definition,
        "plan": plan,
        "exposures": exposures,
        "family": {
            "version": "registered-primary-v1",
            "primary_action_id": primary,
            "included_action_ids": sorted(str(x) for x in included),
            "hypotheses": 1 if plan else 0,
        },
        "actions": [
            [str(v) if v is not None else None for v in row] for row in actions
        ],
        "observations": [
            [d.isoformat(), None if v is None else float(v).hex()]
            for d, v in observations
        ],
        "horizon_reached": bool(
            plan and today > date.fromisoformat(plan["window_end"])
        ),
        "runtime": runtime_identity(),
        "refusal": refusal,
    }
    return MeasurementInput(
        manifest, observations, primary, exposure_date, refusal, resume_at
    )

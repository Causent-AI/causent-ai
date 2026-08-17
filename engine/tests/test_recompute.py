from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from persistence.recompute import _ClaimedJob, _load_input_hash, canonical_input_hash


def _hash(*, value=Decimal("10.0"), effective=date(2026, 7, 1)):
    return canonical_input_hash(
        activation_id=UUID("ca5e0000-0000-0000-0000-000000000001"),
        report_id=UUID("ca5e0000-0000-0000-0000-000000000002"),
        metric_id=UUID("ca5e0000-0000-0000-0000-000000000003"),
        action_ids=[UUID("ca5e0000-0000-0000-0000-000000000004")],
        observations=[(date(2026, 6, 1), value)],
        actions=[(
            UUID("ca5e0000-0000-0000-0000-000000000004"),
            "manual",
            "report-action",
            effective,
            "complete",
        )],
        lever_rows=[(
            UUID("ca5e0000-0000-0000-0000-000000000004"),
            "SHIPPED",
            "manual",
        )],
    )


def test_input_hash_is_stable_for_exact_retry():
    assert _hash() == _hash()
    assert len(_hash()) == 64


def test_input_hash_changes_with_observation_or_action_timing():
    assert _hash(value=Decimal("10.1")) != _hash()
    assert _hash(effective=date(2026, 7, 2)) != _hash()


def test_input_hash_binds_the_explicit_decision_package_contract():
    common = dict(
        activation_id=UUID("ca5e0000-0000-0000-0000-000000000001"),
        report_id=UUID("ca5e0000-0000-0000-0000-000000000002"),
        metric_id=UUID("ca5e0000-0000-0000-0000-000000000003"),
        action_ids=[UUID("ca5e0000-0000-0000-0000-000000000004")],
        observations=[],
        actions=[],
        lever_rows=[],
    )
    first = canonical_input_hash(**common, package_context={
        "causal_object": "decision_package",
        "intervention_action_id": UUID("ca5e0000-0000-0000-0000-000000000004"),
        "individual_attribution": False,
    })
    changed = canonical_input_hash(**common, package_context={
        "causal_object": "decision_package",
        "intervention_action_id": UUID("ca5e0000-0000-0000-0000-000000000005"),
        "individual_attribution": False,
    })
    assert first != changed


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _HashConnection:
    def __init__(self, unrelated_status: str):
        target_id = UUID("ca5e0000-0000-0000-0000-000000000004")
        unrelated_id = UUID("ca5e0000-0000-0000-0000-000000000005")
        start = date(2026, 6, 1)
        self.observations = [
            (start, Decimal("10")),
            (start + timedelta(days=30), Decimal("11")),
        ]
        self.target_actions = [
            (target_id, "manual", "report-action", start + timedelta(days=5), "complete")
        ]
        self.family_actions = [
            *self.target_actions,
            (
                unrelated_id,
                "github",
                "historical-action",
                start + timedelta(days=10),
                unrelated_status,
            ),
        ]
        self.levers = [(target_id, "SHIPPED", "manual")]

    def execute(self, sql, _params=None):
        if "from public.metric_observations" in sql:
            return _Rows(self.observations)
        if "from public.actions" in sql and "action_id = any" in sql:
            return _Rows(self.target_actions)
        if "from public.actions" in sql and "effective_date is not null" in sql:
            return _Rows(self.family_actions)
        if "from public.levers" in sql:
            return _Rows(self.levers)
        raise AssertionError(f"unexpected SQL: {sql}")


def test_worker_input_hash_includes_non_target_fdr_family():
    job = _ClaimedJob(
        activation_id=UUID("ca5e0000-0000-0000-0000-000000000001"),
        scope_id=UUID("ca5e0000-0000-0000-0000-000000000002"),
        report_id=UUID("ca5e0000-0000-0000-0000-000000000003"),
        metric_id=UUID("ca5e0000-0000-0000-0000-000000000006"),
        generation=1,
        attempts=0,
        last_input_hash=None,
        requested_by=None,
    )
    target_ids = [UUID("ca5e0000-0000-0000-0000-000000000004")]

    assert _load_input_hash(
        _HashConnection("complete"), job, target_ids
    ) != _load_input_hash(_HashConnection("cancelled"), job, target_ids)

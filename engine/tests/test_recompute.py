from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from persistence.recompute import canonical_input_hash


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


def test_worker_identity_includes_policy_even_when_source_inputs_match(monkeypatch):
    from persistence.measurement import POLICY
    before = _hash()
    monkeypatch.setitem(POLICY, "q", 0.01)
    assert _hash() != before

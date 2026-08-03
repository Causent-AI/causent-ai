"""Focused bridge guards for report-targeted causal recomputation."""

from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

import numpy as np

import persistence.bridge as bridge
from causal.batch_readout import batch_readout
from causal.types import Series


class _OneRow:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _MetricOnlyConnection:
    def __init__(self, scope_id: UUID):
        self.scope_id = scope_id
        self.commits = 0

    def execute(self, sql, _params=None):
        assert "from public.metrics" in sql
        return _OneRow((self.scope_id, "Activation"))

    def commit(self):
        self.commits += 1


def test_target_filter_keeps_full_fdr_family_without_non_target_writes(monkeypatch):
    """Filtering persistence must not filter the statistical hypothesis family."""
    scope_id = UUID("b1000000-0000-0000-0000-000000000001")
    metric_id = UUID("b1000000-0000-0000-0000-000000000002")
    target_id = UUID("b1000000-0000-0000-0000-000000000003")
    unrelated_ids = [
        UUID(f"b1000000-0000-0000-0000-{value:012d}")
        for value in range(4, 9)
    ]

    start = date(2026, 1, 1)
    count, target_split = 160, 70
    rng = np.random.default_rng(7)
    values = 100.0 + rng.normal(0.0, 4.0, count)
    values[target_split:] += 2.0
    dates = [start + timedelta(days=index) for index in range(count)]
    ordinals = [value.toordinal() for value in dates]
    series = Series(np.array(ordinals, dtype=np.int64), values, 0)
    metric = bridge._LoadedMetric(series, ordinals, dates[0], dates[-1])

    # The target alone clears nominal significance. Adding the complete metric
    # family must demote it under BH-FDR. The action at split 75 also collides
    # with the target, exercising mixed historical/current cluster isolation.
    family_splits = [target_split, 75, 100, 105, 110, 115]
    family_actions = [
        bridge._Action(
            action_id,
            f"action-{index}",
            dates[split],
            split,
        )
        for index, (action_id, split) in enumerate(
            zip([target_id, *unrelated_ids], family_splits)
        )
    ]
    [target_only] = batch_readout(series, [(str(target_id), target_split)])
    assert target_only.belief.belief_score == 1.0

    monkeypatch.setattr(bridge, "_load_metric", lambda *_: metric)

    load_calls = []

    def load_actions(_conn, passed_scope, passed_metric):
        load_calls.append((passed_scope, passed_metric))
        return family_actions

    def assert_target_actions(_conn, passed_scope, action_ids):
        assert passed_scope == scope_id
        assert list(action_ids) == [target_id]
        return [target_id]

    monkeypatch.setattr(bridge, "_load_actions", load_actions)
    monkeypatch.setattr(bridge, "_assert_actions_in_scope", assert_target_actions)

    nodes = []
    edges = []
    its_evidence = []
    descriptive_evidence = []
    persisted_clusters = []

    def upsert_node(_conn, passed_scope, node_type, semantic_ref, _display_name):
        assert passed_scope == scope_id
        nodes.append((node_type, semantic_ref))
        return UUID(
            "b1000000-0000-0000-0000-000000000020"
            if node_type == "METRIC"
            else "b1000000-0000-0000-0000-000000000021"
        )

    def upsert_edge(_conn, passed_scope, _source, _target, belief):
        assert passed_scope == scope_id
        edges.append(belief)
        return UUID("b1000000-0000-0000-0000-000000000022")

    monkeypatch.setattr(bridge, "_upsert_node", upsert_node)
    monkeypatch.setattr(bridge, "_upsert_edge", upsert_edge)
    monkeypatch.setattr(
        bridge,
        "_append_its_evidence",
        lambda _conn, _scope, _edge, action_id, _cluster_id, _its, _placebo, clustered: (
            its_evidence.append((action_id, clustered))
        ),
    )
    monkeypatch.setattr(
        bridge,
        "_append_before_after_evidence",
        lambda _conn, _scope, _edge, action_id, _cluster_id, _readout, clustered: (
            descriptive_evidence.append((action_id, clustered))
        ),
    )
    monkeypatch.setattr(
        bridge,
        "_persist_clusters",
        lambda _conn, _scope, _metric, _node, _loaded, clusters: (
            persisted_clusters.extend(clusters) or []
        ),
    )

    connection = _MetricOnlyConnection(scope_id)
    bridge.persist_metric_readouts(
        connection,
        scope_id,
        metric_id,
        action_ids=[target_id],
        commit=False,
    )

    assert load_calls == [(scope_id, metric)]
    assert nodes == [("METRIC", metric_id), ("ACTION", target_id)]
    assert len(edges) == 1
    assert edges[0].belief_score == 0.5
    assert edges[0].direction == "INCONCLUSIVE"
    assert edges[0].reason == "FDR_DEMOTED"
    assert its_evidence == [(target_id, True)]
    assert descriptive_evidence == [(target_id, True)]
    assert persisted_clusters == []
    assert connection.commits == 0

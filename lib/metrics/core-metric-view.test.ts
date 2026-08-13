import assert from "node:assert/strict";
import test from "node:test";

import { selectCoreMetricDrawerView } from "./core-metric-view.ts";
import type { Metric } from "../types.ts";

function metric(id: string): Metric {
  return {
    id,
    name: id,
    color: "#00A29C",
    format: "percent",
    source: "CSV",
    cadence: "Daily",
    lastUpdated: "2026-08-10T00:00:00Z",
    rows: 1,
    series: [{ date: "2026-08-10", value: 1 }],
    higherIsBetter: true,
  };
}

test("the report target is pinned first and counted separately from core context", () => {
  const view = selectCoreMetricDrawerView({
    metrics: [metric("arr"), metric("adoption"), metric("activation")],
    reportMetricId: "adoption",
    selectedMetricId: null,
  });

  assert.deepEqual(
    view.choices.map(({ metric: choice, role }) => [choice.id, role]),
    [["adoption", "report"], ["arr", "context"], ["activation", "context"]],
  );
  assert.equal(view.selectedChoice?.metric.id, "adoption");
  assert.equal(view.reportMetric?.id, "adoption");
  assert.equal(view.contextMetricCount, 2);
  assert.equal(view.countLabel, "1 report + 2 core");
});

test("selecting a context metric changes only the drawer view", () => {
  const report = metric("adoption");
  const context = metric("activation");
  const view = selectCoreMetricDrawerView({
    metrics: [report, context],
    reportMetricId: report.id,
    selectedMetricId: context.id,
  });

  assert.equal(view.reportMetric, report);
  assert.equal(view.selectedChoice?.metric, context);
  assert.equal(view.selectedChoice?.role, "context");
});

test("duplicate metrics are removed and a stale selection falls back to the report target", () => {
  const report = metric("adoption");
  const view = selectCoreMetricDrawerView({
    metrics: [metric("arr"), report, report],
    reportMetricId: report.id,
    selectedMetricId: "removed-metric",
  });

  assert.deepEqual(view.choices.map(({ metric: choice }) => choice.id), ["adoption", "arr"]);
  assert.equal(view.selectedChoice?.metric.id, "adoption");
  assert.equal(view.countLabel, "1 report + 1 core");
});

test("legacy workspaces count every visible choice as core context", () => {
  const populated = selectCoreMetricDrawerView({
    metrics: [metric("arr"), metric("activation")],
    reportMetricId: null,
    selectedMetricId: "activation",
  });
  const empty = selectCoreMetricDrawerView({
    metrics: [],
    reportMetricId: null,
    selectedMetricId: null,
  });

  assert.equal(populated.reportMetric, null);
  assert.equal(populated.selectedChoice?.metric.id, "activation");
  assert.equal(populated.countLabel, "2 core");
  assert.equal(empty.selectedChoice, null);
  assert.equal(empty.countLabel, "no core metrics");
});

test("five workspace core metrics do not produce a misleading six-of-five label", () => {
  const view = selectCoreMetricDrawerView({
    metrics: [
      metric("report"),
      metric("core-1"),
      metric("core-2"),
      metric("core-3"),
      metric("core-4"),
      metric("core-5"),
    ],
    reportMetricId: "report",
    selectedMetricId: null,
  });

  assert.equal(view.choices.length, 6);
  assert.equal(view.contextMetricCount, 5);
  assert.equal(view.countLabel, "1 report + 5 core");
});

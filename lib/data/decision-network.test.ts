import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDecisionNetwork } from "./decision-network.ts";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "../decision-reports/fixtures/gummy-alpha.ts";
import type { DashboardDecisionReport } from "./decision-reports.ts";
const report: DashboardDecisionReport = {
  id: "report-1",
  revisionId: "revision-1",
  title: "A decision",
  status: "draft",
  updatedAt: "2026-09-22T12:00:00Z",
  report: structuredClone(GUMMY_ALPHA_GOLDEN_EXAMPLE.report),
  metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
  activeActivationId: null,
  decisionId: null,
  predictionId: null,
  metricId: "db-metric",
  activeMetricName: null,
  seriesId: "series-1",
  iterationNumber: 1,
  predecessorReportId: null,
  iterationReason: null,
  isCurrent: false,
};
test("network joins database metric identities and keeps workspaces separate", () => {
  const input = {
    workspaceId: "workspace-a",
    project: "Project",
    workspace: "Workspace",
    reports: [report],
    decisions: [],
    actions: [],
    metrics: [],
    metricIds: { "db-metric": "metric-db-metric" },
  };
  const [node] = buildDecisionNetwork(input);
  assert.ok(node.metricIds.includes("workspace-a:metric-db-metric"));
  assert.deepEqual(node.impacts, []);
  assert.equal(node.dateLabel, "Draft updated");
  assert.equal(node.predecessorId, null);
  const [other] = buildDecisionNetwork({
    ...input,
    workspaceId: "workspace-b",
  });
  assert.ok(!other.metricIds.includes("workspace-a:metric-db-metric"));
});
test("network preserves only explicit version edges and deterministic timeline order", () => {
  const nodes = buildDecisionNetwork({
    workspaceId: "w",
    project: "p",
    workspace: "s",
    reports: [
      {
        ...report,
        id: "report-2",
        predecessorReportId: "report-1",
        updatedAt: "2026-09-23",
      },
      report,
    ],
    decisions: [],
    actions: [],
    metrics: [],
  });
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["report-1", "report-2"],
  );
  assert.equal(nodes[1].predecessorId, "report-1");
  assert.equal(nodes[0].predecessorId, null);
});

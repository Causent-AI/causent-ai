// Workspace summaries share the registered measurement and explicit-definition
// gates used by Actions. Distinct measurement windows are never summed as effects.
import { getMetricRecords } from "@/lib/data/metrics";
import { loadEdgeReadouts } from "@/lib/data/graph";
import { summarizeMetricImpact, summarizeObservedImprovement } from "./impact-summary.ts";

async function workspaceEvidence(scopeId: string) {
  const [records, edges] = await Promise.all([getMetricRecords(scopeId), loadEdgeReadouts(scopeId)]);
  return { metrics: records.map((record) => record.metric), edges: [...edges.values()] };
}

export async function getImpactByMetric(scopeId: string) {
  const { metrics, edges } = await workspaceEvidence(scopeId);
  return summarizeMetricImpact(metrics, edges);
}

export async function getAggregatedImpact(scopeId: string) {
  const { metrics, edges } = await workspaceEvidence(scopeId);
  return summarizeObservedImprovement(metrics, edges);
}

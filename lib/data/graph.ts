// One statement joins each edge to evidence from its current trusted evaluation.
import { cache } from "react";
import { readCurrentEdgeRows } from "./graph-query.ts";
import { getServerSupabase } from "@/lib/supabase-server";

/** One materialized ACTION -> METRIC readout, already joined to its ITS lift. */
export type EdgeReadout = {
  evaluationId?: string | null;
  provenance?: "computed" | "manual" | "legacy_unverified" | "incomplete";
  inputHash?: string | null;
  modelVersion?: string | null;
  actionId: string;
  metricId: string;
  /** Raw engine direction: 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE'. */
  dbDirection: string;
  /** 0..1, or null when belief is withheld ("we don't know"). */
  beliefScore: number | null;
  /** Why belief was withheld/demoted (INSUFFICIENT_HISTORY, FDR_DEMOTED, …) or null. */
  beliefReason: string | null;
  /** Step estimate from the latest authoritative ITS evidence row (native units). */
  lift: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  nPre: number | null;
  nPost: number | null;
  /** Non-authoritative 14-day before/after mean shift, when evaluable. */
  descriptiveLift: number | null;
  descriptiveCiLow: number | null;
  descriptiveCiHigh: number | null;
  descriptiveNPre: number | null;
  descriptiveNPost: number | null;
  /** True when another action's 14-day window overlaps this action. */
  descriptiveClustered: boolean;
};

/** Composite key for the (action, metric) lookup. */
export function edgeKey(actionId: string, metricId: string): string {
  return `${actionId}::${metricId}`;
}

export const loadGraphReadouts = cache(async function loadGraphReadouts(scopeId: string) {
  const sb = await getServerSupabase();
  const result = await readCurrentEdgeRows(sb, scopeId);
  const readouts = new Map<string, EdgeReadout>();
  for (const row of result.rows) {
    readouts.set(edgeKey(row.action_id, row.metric_id), {
      actionId: row.action_id,
      metricId: row.metric_id,
      evaluationId: row.evaluation_id,
      provenance: row.provenance,
      inputHash: row.input_hash,
      modelVersion: row.model_version,
      dbDirection: row.direction,
      beliefScore: row.belief_score,
      beliefReason: row.belief_reason,
      lift: row.lift,
      ciLow: row.ci_low,
      ciHigh: row.ci_high,
      nPre: row.n_pre,
      nPost: row.n_post,
      descriptiveLift: row.descriptive_lift,
      descriptiveCiLow: row.descriptive_ci_low,
      descriptiveCiHigh: row.descriptive_ci_high,
      descriptiveNPre: row.descriptive_n_pre,
      descriptiveNPost: row.descriptive_n_post,
      descriptiveClustered: row.descriptive_clustered,
    });
  }
  return { readouts, completeness: result.completeness };
});

export async function loadEdgeReadouts(scopeId: string): Promise<Map<string, EdgeReadout>> {
  return (await loadGraphReadouts(scopeId)).readouts;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { collectKeyset } from "./keyset.ts";

export type ReadoutRow = {
  edge_id: string;
  action_id: string;
  metric_id: string;
  evaluation_id: string | null;
  provenance: "computed" | "manual" | "legacy_unverified" | "incomplete";
  input_hash: string | null;
  model_version: string | null;
  direction: string;
  belief_score: number | null;
  belief_reason: string | null;
  lift: number | null;
  ci_low: number | null;
  ci_high: number | null;
  n_pre: number | null;
  n_post: number | null;
  descriptive_lift: number | null;
  descriptive_ci_low: number | null;
  descriptive_ci_high: number | null;
  descriptive_n_pre: number | null;
  descriptive_n_post: number | null;
  descriptive_clustered: boolean;
};

export function readCurrentEdgeRows(sb: SupabaseClient, scopeId: string) {
  return collectKeyset<ReadoutRow>((after, size) => {
    let query = sb.from("current_edge_readouts").select("*")
      .eq("scope_id", scopeId).order("edge_id").limit(size);
    if (after) query = query.gt("edge_id", after);
    return query;
  }, (row) => row.edge_id);
}

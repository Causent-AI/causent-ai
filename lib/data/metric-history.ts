import type { SupabaseClient } from "@supabase/supabase-js";
import { collectKeyset } from "./keyset.ts";

export type HistoryWindow = { from?: string; through?: string };
export type ObservationRow = { metric_id: string; obs_date: string; value: number | string | null };

export async function readMetricHistory(sb: SupabaseClient, metricId: string, window: HistoryWindow = {}) {
  for (const bound of [window.from, window.through]) {
    if (bound !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(bound) ||
      !Number.isFinite(Date.parse(`${bound}T00:00:00Z`)) ||
      new Date(`${bound}T00:00:00Z`).toISOString().slice(0, 10) !== bound)) {
      throw new Error("Invalid history date window");
    }
  }
  if (window.from && window.through && window.from > window.through) throw new Error("Invalid history date window");
  const result = await collectKeyset<ObservationRow>((after, size) => {
    let query = sb.from("metric_observations").select("metric_id, obs_date, value")
      .eq("metric_id", metricId).order("obs_date").limit(size);
    if (window.from) query = query.gte("obs_date", window.from);
    if (window.through) query = query.lte("obs_date", window.through);
    if (after) query = query.gt("obs_date", after);
    return query;
  }, (row) => row.obs_date);
  return { ...result, completeness: { ...result.completeness, window } };
}

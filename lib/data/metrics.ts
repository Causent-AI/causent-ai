// getMetrics() — the daily metric series + display config, mapped from Supabase to
// lib/types.ts Metric. Mirrors the lib/seed.ts `metrics` export.

import { cache } from "react";
import { collectKeyset } from "./keyset.ts";
import { readMetricHistory, type HistoryWindow } from "./metric-history.ts";
import type { Metric, Observation } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  METRIC_CONFIG_BY_NAME,
  METRIC_ORDER,
  formatFromUnit,
  sourceLabel,
} from "@/lib/data/config";

type MetricRow = {
  metric_id: string;
  name: string;
  unit: string | null;
  source: string;
  granularity: string;
  is_core: boolean;
};
type DefinitionRow = {
  definition_id: string;
  metric_id: string;
  numeric_scale: "native" | "ratio" | "points";
  beneficial_direction: "higher" | "lower" | "neutral";
};
/**
 * A UI Metric paired with its DB metric_id (UUID). The UI Metric.id is the stable
 * slug; the graph (nodes/edges) keys by metric_id, so callers that join readouts
 * (actions, impact) need both.
 */
export type MetricRecord = {
  metricId: string;
  metric: Metric;
  configured: boolean;
  isCore: boolean;
  observationRead: Awaited<ReturnType<typeof readMetricHistory>>["completeness"];
};

/**
 * Workspace metrics with complete, bounded daily history. Known metrics use the
 * canonical UI order; other metrics retain the existing neutral presentation.
 */
export const getMetricRecords = cache(async function getMetricRecords(scopeId: string, window: HistoryWindow = {}): Promise<
  MetricRecord[]
> {
  const sb = await getServerSupabase();

  const { rows: metricRows } = await collectKeyset<MetricRow>((after, size) => {
    let query = sb.from("metrics").select("metric_id, name, unit, source, granularity, is_core")
      .eq("scope_id", scopeId).order("metric_id").limit(size);
    if (after) query = query.gt("metric_id", after);
    return query;
  }, (row) => row.metric_id, 100);
  if (metricRows.length === 0) return [];

  const definitions = await collectKeyset<DefinitionRow>((after, size) => {
    let query = sb.from("metric_definitions")
      .select("definition_id, metric_id, numeric_scale, beneficial_direction")
      .eq("scope_id", scopeId).order("metric_id").limit(size);
    if (after) query = query.gt("metric_id", after);
    return query;
  }, (row) => row.metric_id, 100);
  const definitionByMetric = new Map(definitions.rows.map((row) => [row.metric_id, row]));

  const obsResults: Awaited<ReturnType<typeof readMetricHistory>>[] = [];
  for (let i = 0; i < metricRows.length; i += 4) {
    obsResults.push(...await Promise.all(metricRows.slice(i, i + 4)
      .map((row) => readMetricHistory(sb, row.metric_id, window))));
  }

  const seriesByMetric = new Map<string, Observation[]>();
  const lastDateByMetric = new Map<string, string>();
  for (const res of obsResults) {
    for (const o of res.rows) {
      if (o.value == null) continue; // NULL day: no observation to plot
      const list = seriesByMetric.get(o.metric_id) ?? [];
      list.push({ date: o.obs_date, value: Number(o.value) });
      seriesByMetric.set(o.metric_id, list);
      lastDateByMetric.set(o.metric_id, o.obs_date);
    }
  }

  const records: MetricRecord[] = [];
  for (const [index, row] of metricRows.entries()) {
    const configured = METRIC_CONFIG_BY_NAME[row.name] ?? null;
    // Report-created metrics are intentionally not limited to the legacy demo
    // catalog. They receive neutral presentation defaults; their database UUID
    // remains the identity used for all authorization and writes.
    const cfg = configured ?? {
      id: `metric-${row.metric_id}`,
      color: "#00A29C",
    };
    const series = seriesByMetric.get(row.metric_id) ?? [];
    const definition = definitionByMetric.get(row.metric_id);
    const lastDate = lastDateByMetric.get(row.metric_id);
    records.push({
      metricId: row.metric_id,
      configured: configured !== null,
      isCore: row.is_core === true,
      observationRead: obsResults[index].completeness,
      metric: {
        id: cfg.id,
        name: row.name,
        color: cfg.color,
        format: formatFromUnit(row.unit),
        source: sourceLabel(row.source),
        cadence: "Daily",
        // Honest last-ingest proxy: the latest observation date (no separate ingest
        // timestamp is stored). Midnight UTC of that day.
        lastUpdated: lastDate ? `${lastDate}T00:00:00Z` : new Date(0).toISOString(),
        rows: series.length,
        higherIsBetter: definition?.beneficial_direction === "higher",
        beneficialDirection: definition?.beneficial_direction ?? "unknown",
        percentScale: row.unit === "percent"
          ? definition?.numeric_scale === "ratio" ? "ratio" : definition?.numeric_scale === "points" ? "points" : "unknown"
          : "points",
        definitionId: definition?.definition_id ?? null,
        series,
      },
    });
  }

  records.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    if (!a.configured) return a.metric.name.localeCompare(b.metric.name);
    return METRIC_ORDER.indexOf(a.metric.id) - METRIC_ORDER.indexOf(b.metric.id);
  });
  return records;
});

/**
 * All metrics in the demo scope with their full daily series, ordered to match the
 * UI's canonical metric order. Mirrors the lib/seed.ts `metrics` export.
 */
export async function getMetrics(scopeId: string): Promise<Metric[]> {
  return (await getMetricRecords(scopeId)).map((r) => r.metric);
}

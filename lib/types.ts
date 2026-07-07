// Shared types for the Causent v1 UI. These deliberately mirror the shape of the
// persisted schema (supabase/migrations) so the seed layer can later be swapped for
// RLS-scoped Supabase reads without touching components.

/** org → project → workspace scope hierarchy (see decision-graph.md). */
export type Scope = {
  org: string;
  project: string;
  workspace: string;
};

/** A single day of a metric's time series. `date` is an ISO yyyy-mm-dd string. */
export type Observation = {
  date: string;
  value: number;
};

/** How a metric's value should be rendered. */
export type MetricFormat = "currency" | "percent" | "count";

export type Metric = {
  id: string;
  name: string;
  /** Stable brand-safe series color (hex). */
  color: string;
  format: MetricFormat;
  source: "CSV" | "Postgres" | "BigQuery";
  cadence: "Daily";
  /** ISO timestamp of last ingest. */
  lastUpdated: string;
  rows: number;
  /** Daily observations, ascending by date. */
  series: Observation[];
  /** For a metric, is "up" good? churn/support-tickets are inverted. */
  higherIsBetter: boolean;
};

/**
 * Direction of an effect, triple-encoded downstream (glyph + position + color +
 * label) so it never relies on color alone (colorblind-safe requirement).
 */
export type Direction = "up" | "down" | "neutral";

/** One authoritative readout cell: an action's estimated impact on one metric. */
export type ImpactCell = {
  metricId: string;
  direction: Direction;
  /** Signed magnitude in the metric's native unit. null = no measured effect ("—"). */
  value: number | null;
  /** Pre-formatted display label, e.g. "+$120K", "+3.1pp", "—". */
  label: string;
  /** Whether this cell is a positive business outcome (accounts for inverted metrics). */
  good: boolean;
};

/** A shipped action (v1: a merged GitHub PR). */
export type Action = {
  id: string;
  /** GitHub PR number, e.g. 8421. */
  pr: number;
  title: string;
  /** ISO yyyy-mm-dd ship date. */
  shippedAt: string;
  /** The metric this action primarily targeted. */
  primaryMetricId: string;
  /** Per-metric authoritative impact cells (ITS row). */
  impact: ImpactCell[];
  /** Rich-text-ish rationale ("Why did we build this?"). Plain paragraphs for v1. */
  rationale?: {
    hypothesis: string;
    expectedMetricId: string;
    body: string[];
  };
};

/** One card in the Aggregated Impact strip. */
export type ImpactStat = {
  label: string;
  value: string;
  /** Comparison sublabel, e.g. "vs 11". */
  comparison: string;
  /** Optional signed change chip, e.g. "+64%". */
  change?: string;
  tone: "positive" | "negative" | "neutral" | "plain";
};

/** One row of the Impact-by-Metric diverging bar chart. */
export type MetricImpact = {
  metricId: string;
  /** Position on the $-axis (native magnitude used for bar length). */
  value: number;
  /** Display label, e.g. "+$212K" or "+6.3pp". */
  label: string;
  direction: Direction;
  good: boolean;
};

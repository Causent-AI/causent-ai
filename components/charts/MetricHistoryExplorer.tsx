"use client";

import { useId, useState } from "react";

import {
  LineTimeSeries,
  type SeriesFlag,
} from "@/components/charts/LineTimeSeries";
import { VolumeChangeChart } from "@/components/charts/VolumeChangeChart";
import { formatLongDate, formatMetricValue } from "@/lib/format";
import {
  buildMetricHistoryContext,
  buildReportActionMarkers,
} from "@/lib/metrics/action-visuals";
import {
  filterSeriesRange,
  prepareSeriesView,
  type SeriesCadence,
  type SeriesRange,
} from "@/lib/metrics/series-controls";
import type { Action, Metric } from "@/lib/types";

type HistoryMode = "trend" | "momentum";

const RANGE_OPTIONS: Array<{ value: SeriesRange; label: string }> = [
  { value: "30d", label: "30 days" },
  { value: "60d", label: "60 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All loaded" },
];

const MODE_COPY: Record<HistoryMode, string> = {
  trend:
    "Observed values and report-action completion dates. Timing alone does not show that an action caused a change.",
  momentum:
    "Week-over-week and month-over-month rates use exact calendar baselines. Missing baselines remain gaps; this view is descriptive, not causal.",
};

/**
 * Client-only controls over a Metric and Action list already isolated by the
 * server to the explicit current report. This component never fetches or
 * accepts a report identity of its own.
 */
export function MetricHistoryExplorer({
  metric,
  actions,
  primaryActionId,
}: {
  metric: Metric;
  actions: Action[];
  primaryActionId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<HistoryMode>("trend");
  const [range, setRange] = useState<SeriesRange>("90d");
  const [cadence, setCadence] = useState<SeriesCadence>("daily");
  const id = useId();
  const panelId = `${id}-panel`;
  const chartId = `${id}-chart`;
  const chartTitleId = `${id}-chart-title`;

  const visibleSeries = filterSeriesRange(metric.series, range);
  const view = prepareSeriesView(metric.series, range, cadence);
  const context = buildMetricHistoryContext(metric.series, visibleSeries);
  const actionMarkers = buildReportActionMarkers(
    actions,
    primaryActionId,
    visibleSeries,
  );
  const flags: SeriesFlag[] = actionMarkers.map((marker) => ({
    date: marker.date,
    label: marker.isPrimary ? `P · ${marker.label}` : marker.label,
    color: marker.isPrimary ? "var(--brand-amber)" : metric.color,
    href: `/actions?selected=${encodeURIComponent(marker.actionId)}#${encodeURIComponent(marker.actionId)}`,
    title: marker.isPrimary
      ? `Primary action: ${marker.title}`
      : marker.title,
  }));
  const hasObservations = context.totalObservations > 0;
  const currentValue = context.latestValue === null
    ? "—"
    : formatMetricValue(context.latestValue, metric.format);
  const currentDate = context.latestDate
    ? formatLongDate(context.latestDate)
    : "No observations connected";
  const visibleDateRange = context.visibleStartDate && context.visibleEndDate
    ? `${formatLongDate(context.visibleStartDate)} – ${formatLongDate(context.visibleEndDate)}`
    : "No dates available";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-14 w-full flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-black/[0.015] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
            Metric history
          </span>
          <span className="mt-0.5 block truncate text-[13px] font-semibold text-[var(--text)]">
            {metric.name}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-right">
            <span className="block text-[15px] font-semibold tabular-nums text-[var(--text)]">
              {currentValue}
            </span>
            <span className="block text-[9px] text-[var(--text-subtle)]">
              {currentDate}
            </span>
          </span>
          <span className="min-w-11 text-right text-[10px] font-semibold text-[var(--brand-blue)]">
            {expanded ? "Hide" : "Explore"}
          </span>
        </span>
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-[var(--border)] p-3 sm:p-4">
          <div className="grid gap-3 rounded-lg bg-[var(--bg)] px-3 py-2.5 text-[11px] sm:grid-cols-3">
            <div>
              <p className="font-medium text-[var(--text-subtle)]">Last observation</p>
              <p className="mt-0.5 font-semibold tabular-nums text-[var(--text)]">
                {currentValue} · {currentDate}
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-subtle)]">Visible range</p>
              <p className="mt-0.5 font-semibold tabular-nums text-[var(--text)]">
                {visibleDateRange}
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-subtle)]">Observation context</p>
              <p className="mt-0.5 font-semibold tabular-nums text-[var(--text)]">
                {context.visibleObservations} shown · {context.totalObservations} total
                {cadence === "weekly" && view.levels.length > 0
                  ? ` · ${view.levels.length} weekly means`
                  : ""}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <fieldset>
              <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                View
              </legend>
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-0.5">
                {(["trend", "momentum"] as HistoryMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    aria-controls={chartId}
                    onClick={() => setMode(option)}
                    className={`min-h-11 rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-blue)] ${
                      mode === option
                        ? "bg-[var(--text)] text-white"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg)]"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Range
                <select
                  value={range}
                  disabled={!hasObservations}
                  onChange={(event) => setRange(event.target.value as SeriesRange)}
                  className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-base font-normal normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--brand-blue)] disabled:opacity-50 sm:w-36 sm:text-[11px]"
                >
                  {RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Cadence
                <select
                  value={cadence}
                  disabled={!hasObservations}
                  onChange={(event) => setCadence(event.target.value as SeriesCadence)}
                  className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-base font-normal normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--brand-blue)] disabled:opacity-50 sm:w-28 sm:text-[11px]"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>
          </div>

          {!hasObservations ? (
            <div
              id={chartId}
              role="status"
              className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-5"
            >
              <p className="text-[12px] font-semibold text-amber-950">
                No metric history to chart
              </p>
              <p className="mt-1 text-[11px] leading-5 text-amber-900/80">
                Connect or import daily observations in Data Workshop. Causent will not infer a trend from the report text.
              </p>
            </div>
          ) : (
            <figure
              id={chartId}
              aria-labelledby={chartTitleId}
              className="mt-4 rounded-xl border border-[var(--border)] bg-white p-3 sm:p-4"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h4 id={chartTitleId} className="text-[12px] font-semibold text-[var(--text)]">
                  {mode === "trend" ? "Observed metric trend" : "Observed momentum"}
                </h4>
                <span className="text-[10px] text-[var(--text-subtle)]">
                  {cadence === "daily" ? "Daily observations" : "Weekly means"}
                </span>
              </div>

              {mode === "trend" ? (
                <LineTimeSeries
                  series={view.levels}
                  color={metric.color}
                  format={metric.format}
                  flags={flags}
                  height={180}
                  xTicks={4}
                />
              ) : (
                <VolumeChangeChart
                  view={view}
                  color={metric.color}
                  format={metric.format}
                  flags={flags}
                />
              )}

              <figcaption className="mt-3 border-t border-[var(--border)] pt-2 text-[10px] leading-4 text-[var(--text-muted)]">
                {MODE_COPY[mode]} Checked causal estimates appear in Impact.
              </figcaption>
            </figure>
          )}

          {hasObservations ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Report actions in this window
              </p>
              {actionMarkers.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Report action markers">
                  {actionMarkers.map((marker) => (
                    <li
                      key={marker.actionId}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-[10px] text-[var(--text-muted)]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: marker.isPrimary
                            ? "var(--brand-amber)"
                            : metric.color,
                        }}
                        aria-hidden="true"
                      />
                      <span className="font-semibold text-[var(--text)]">
                        {marker.isPrimary ? "Primary" : "Action"} {marker.label}
                      </span>
                      <time dateTime={marker.date} className="tabular-nums">
                        {formatLongDate(marker.date)}
                      </time>
                      <span className="max-w-52 truncate" title={marker.title}>
                        {marker.title}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                  No current-report action has a completion date inside this range.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

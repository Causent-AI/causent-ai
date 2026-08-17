"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Action, Decision, Metric } from "@/lib/types";
import { formatLongDate, formatMetricValue, formatShortDate } from "@/lib/format";
import type { SeriesFlag } from "@/components/charts/LineTimeSeries";
import { VolumeChangeChart } from "@/components/charts/VolumeChangeChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { CalendarIcon, ChevronIcon } from "@/components/ui/icons";
import { selectReportMetricView } from "@/lib/data/action-plan-view";
import { selectCoreMetricDrawerView } from "@/lib/metrics/core-metric-view";
import {
  filterSeriesRange,
  prepareSeriesView,
  type RateObservation,
  type SeriesCadence,
  type SeriesRange,
} from "@/lib/metrics/series-controls";

// Persistent bottom drawer. Core metrics "run through everything" — a daily time
// series per metric with named action flags, always checkable in the background.
// Data (metrics/actions/window) is fetched by the server layout and threaded in as
// props; this component never reads the DB or the seed directly.

const MAX_FLAGS = 5; // thin so PR pills never overlap
const RANGE_OPTIONS: SeriesRange[] = ["30d", "60d", "90d", "all"];

function latestRate(series: RateObservation[]): number | null {
  return series.at(-1)?.value ?? null;
}

function formatRate(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function rateTone(value: number | null, higherIsBetter: boolean): string {
  if (value === null || Math.abs(value) < 0.0001) return "text-[var(--text-subtle)]";
  return (value > 0) === higherIsBetter
    ? "text-[var(--pos)]"
    : "text-[var(--neg)]";
}

/** Evenly sample at most `max` items so flags stay readable. */
function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

export function CoreMetricsDrawer({
  metrics,
  actions,
  decisions,
  projectMetricLabel,
}: {
  metrics: Metric[];
  actions: Action[];
  decisions: Decision[];
  projectMetricLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<SeriesRange>("60d");
  const [cadence, setCadence] = useState<SeriesCadence>("daily");
  const [selectedMetricId, setSelectedMetricId] = useState("");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reportMetricView = pathname === "/actions"
    ? selectReportMetricView(searchParams.get("selected"), decisions, metrics, actions)
    : null;
  // loadDashboardData() keeps the current report metric first. A selected
  // report decision gives us the same target explicitly on Actions.
  const canonicalReportMetric = reportMetricView?.metric
    ?? (projectMetricLabel ? metrics[0] ?? null : null);
  const drawerView = selectCoreMetricDrawerView({
    metrics,
    reportMetricId: canonicalReportMetric?.id ?? null,
    selectedMetricId,
  });
  const selectedChoice = drawerView.selectedChoice;
  const selectedMetric = selectedChoice?.metric;
  const visibleActions = reportMetricView?.actions ?? actions;
  const selectedMetricNeedsData = !selectedMetric || selectedMetric.series.length === 0;
  const metricCountLabel = drawerView.countLabel;

  const chartMetrics = selectedMetric ? [selectedMetric].map((metric) => ({
    metric,
    view: prepareSeriesView(metric.series, range, cadence),
    flagWindow: filterSeriesRange(metric.series, range),
  })) : [];
  const summaryMetrics = drawerView.summaryChoices.map(({ metric, role }) => ({
    metric,
    role,
    view: prepareSeriesView(metric.series, range, cadence),
  }));
  const visibleSeries = selectedMetric?.series ?? [];

  const flagsForMetric = (color: string, series: Metric["series"]): SeriesFlag[] => {
    const windowStart = series[0]?.date ?? "";
    const windowEnd = series.at(-1)?.date ?? "";
    return thin(
      visibleActions
        .filter((action) =>
          action.shippedAt !== null &&
          action.shippedAt >= windowStart &&
          action.shippedAt <= windowEnd,
        )
        .sort((left, right) => (left.shippedAt ?? "").localeCompare(right.shippedAt ?? "")),
      MAX_FLAGS,
    ).map((action) => ({
      date: action.shippedAt!,
      label: action.displayCode ?? action.referenceLabel ?? (action.pr > 0 ? `#${action.pr}` : "Action"),
      color,
      href: `/actions?selected=${encodeURIComponent(action.id)}#${encodeURIComponent(action.id)}`,
      title: action.title,
    }));
  };

  function rangeOptionLabel(option: SeriesRange): string {
    const optionSeries = filterSeriesRange(visibleSeries, option);
    if (optionSeries.length === 0) return option === "all" ? "All data" : `Last ${option.slice(0, -1)} days`;
    const dates = `${formatShortDate(optionSeries[0].date)} – ${formatLongDate(optionSeries.at(-1)!.date)}`;
    return option === "all" ? `All data · ${dates}` : dates;
  }

  return (
    <section className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)]">
      {/* drawer header (wraps on narrow viewports so the controls never overlap) */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-y-1 px-5 py-1">
        <button
          type="button"
          aria-controls="core-metrics-content"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 items-center gap-2 text-[13px] font-semibold text-[var(--text)]"
        >
          <ChevronIcon
            size={16}
            className={`text-[var(--text-muted)] transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--brand-teal)" }}
            aria-hidden="true"
          />
          Core Metrics
          <span className="text-[var(--text-subtle)]">
            {metricCountLabel}
          </span>
        </button>

        {open ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
            <label className="relative flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-muted)] focus-within:border-[var(--brand-blue)]">
              <CalendarIcon className="text-[var(--text-subtle)]" />
              <span className="sr-only">Chart date range</span>
              <select
                aria-label="Chart date range"
                value={range}
                onChange={(event) => setRange(event.target.value as SeriesRange)}
                disabled={selectedMetricNeedsData}
                className="max-w-[230px] appearance-none bg-transparent pr-4 outline-none disabled:opacity-50"
              >
                {RANGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{rangeOptionLabel(option)}</option>
                ))}
              </select>
              <ChevronIcon size={13} className="pointer-events-none absolute right-1.5 text-[var(--text-subtle)]" />
            </label>
            <label className="relative flex items-center rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-muted)] focus-within:border-[var(--brand-blue)]">
              <span className="sr-only">Chart cadence</span>
              <select
                aria-label="Chart cadence"
                value={cadence}
                onChange={(event) => setCadence(event.target.value as SeriesCadence)}
                disabled={selectedMetricNeedsData}
                className="appearance-none bg-transparent pr-5 outline-none disabled:opacity-50"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              <ChevronIcon size={13} className="pointer-events-none absolute right-1.5 text-[var(--text-subtle)]" />
            </label>
          </div>
        ) : null}
      </div>

      {open && (
        <div id="core-metrics-content" className="px-5 pb-4">
          <div className="flex justify-end border-t border-[var(--border)] pt-3">
            <Link
              href="/data-workshop"
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
            >
              Manage Core Metrics
            </Link>
          </div>

          {drawerView.choices.length > 0 ? (
            <div className="scroll-slim mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="View metric">
              {drawerView.choices.map(({ metric, role }) => {
                const selected = selectedMetric?.id === metric.id;
                return (
                  <button
                    key={metric.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedMetricId(metric.id)}
                    className={`min-h-11 min-w-[150px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-[var(--brand-blue)] bg-blue-50 text-[var(--text)]"
                        : "border-[var(--border)] bg-white text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[12px] font-semibold">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: metric.color }} aria-hidden="true" />
                      <span className="truncate">{metric.name}</span>
                    </span>
                    <span className="mt-0.5 block text-[10px] font-medium text-[var(--text-subtle)]">
                      {role === "report" ? "Report target" : "Context"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="mt-3 flex flex-col gap-4 lg:flex-row">
            {selectedMetricNeedsData ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                <div>
                  <p className="text-[12px] font-semibold text-amber-950">
                    {selectedMetric?.name ?? reportMetricView?.metricLabel ?? projectMetricLabel ?? "No core metric confirmed"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-900/75">
                    This metric has no connected series to chart yet.
                  </p>
                </div>
                <Link
                  href="/data-workshop"
                  className="rounded-lg bg-amber-900 px-3 py-2 text-[11px] font-semibold text-white"
                >
                  Connect metric data
                </Link>
              </div>
            ) : null}
            {!selectedMetricNeedsData ? (
              <>
                {/* one selected metric at a time */}
                <div className="flex-1 space-y-1">
                  {chartMetrics.map(({ metric: m, view, flagWindow }) => {
                    return (
                      <div key={m.id} className="min-w-0 flex-1">
                        <VolumeChangeChart
                          view={view}
                          color={m.color}
                          format={m.format}
                          flags={selectedChoice?.role === "report" ? flagsForMetric(m.color, flagWindow) : []}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 lg:w-[360px] lg:shrink-0">
                  <div className="mb-3">
                    <h3 className="text-[13px] font-semibold text-[var(--text)]">
                      Core Metrics Summary
                    </h3>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
                    <span>Metric</span>
                    <span className="text-right">Current</span>
                    <span className="text-right">WoW</span>
                    <span className="text-right">MoM</span>
                  </div>

                  <div className="mt-1.5 space-y-1.5">
                    {summaryMetrics.map(({ metric: m, role, view }, index) => {
                      const current = view.levels.at(-1)?.value;
                      const wow = latestRate(view.wow);
                      const mom = latestRate(view.mom);
                      const selected = selectedMetric?.id === m.id;
                      return (
                        <div
                          key={m.id}
                          className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 ${
                            selected ? "pb-3" : "py-1.5"
                          } ${index === 1 ? "border-t border-[var(--border)] pt-3" : ""}`}
                        >
                          <div className="flex min-w-0 items-center gap-2" title={role === "report" ? "Report target" : "Context metric"}>
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: m.color }}
                              aria-hidden="true"
                            />
                            <span className={`truncate text-[var(--text)] ${selected ? "text-[15px] font-semibold" : "text-[12px]"}`}>
                              {m.name}
                            </span>
                            {view.levels.length > 0 ? (
                              <span className="hidden xl:block">
                                <Sparkline series={view.levels} color={m.color} width={48} height={22} />
                              </span>
                            ) : null}
                          </div>
                          <span className={`text-right font-semibold tabular-nums text-[var(--text)] ${selected ? "text-[15px]" : "text-[12px]"}`}>
                            {current === undefined ? "—" : formatMetricValue(current, m.format)}
                          </span>
                          <span className={`text-right font-semibold tabular-nums ${selected ? "text-[12px]" : "text-[11px]"} ${rateTone(wow, m.higherIsBetter)}`}>
                            {formatRate(wow)}
                          </span>
                          <span className={`text-right font-semibold tabular-nums ${selected ? "text-[12px]" : "text-[11px]"} ${rateTone(mom, m.higherIsBetter)}`}>
                            {formatRate(mom)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

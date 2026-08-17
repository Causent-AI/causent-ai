import Link from "next/link";

import { indexOfDate, linePoints, paddedExtent, tickIndices, yFrac } from "@/components/charts/geometry";
import { Panel } from "@/components/ui/Panel";
import { formatLongDate, formatMonthTick, formatShortDate } from "@/lib/format";
import type { ReportImpactTimelineLevel } from "@/lib/impact/report-impact";
import { formatReportMetricLevel } from "@/lib/impact/report-impact";
import { buildReportActionMarkers } from "@/lib/metrics/action-visuals";
import type { Action, Metric } from "@/lib/types";

const WIDTH = 900;
const HEIGHT = 260;
const PLOT_LEFT = 62;
const PLOT_TOP = 42;
const PLOT_WIDTH = 808;
const PLOT_HEIGHT = 170;

const LEVEL_STYLE = {
  baseline: { color: "var(--brand-blue)", dash: "5 4" },
  target: { color: "var(--brand-teal)", dash: "2 4" },
} as const;

export function ReportImpactTimeline({
  metric,
  actions,
  primaryActionId,
  levels,
}: {
  metric: Metric;
  actions: Action[];
  primaryActionId: string | null;
  levels: ReportImpactTimelineLevel[];
}) {
  const series = metric.series;
  const markers = buildReportActionMarkers(actions, primaryActionId, series);

  if (series.length === 0) {
    return (
      <Panel>
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Observed outcome timeline</h2>
        <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-6">
          <p className="text-[12px] font-semibold text-amber-950">No daily observations</p>
          <Link href="/data-workshop" className="mt-2 inline-flex text-[11px] font-semibold text-amber-900 underline-offset-2 hover:underline">
            Import data →
          </Link>
        </div>
      </Panel>
    );
  }

  const extent = paddedExtent([
    ...series.map((observation) => observation.value),
    ...levels.map((level) => level.value),
  ], 0.12);
  const yTickValues = Array.from({ length: 4 }, (_, index) => {
    const fraction = index / 3;
    return extent.max - fraction * (extent.max - extent.min);
  });
  const xTickIndexes = [...new Set(tickIndices(series.length, 5))];
  const points = linePoints(series, extent, PLOT_WIDTH, PLOT_HEIGHT);
  const xForIndex = (index: number) =>
    series.length <= 1 ? 0 : (index / (series.length - 1)) * PLOT_WIDTH;
  const ariaParts = [
    `${metric.name}, ${series.length} daily observations from ${formatLongDate(series[0].date)} to ${formatLongDate(series.at(-1)!.date)}.`,
    ...levels.map((level) => `${level.label} ${level.displayLabel}.`),
    markers.length === 0
      ? "No completed report actions fall inside the observation window."
      : `${markers.length} completed report action markers; ${markers.find((marker) => marker.isPrimary)?.label ?? "no action"} is the primary action.`,
  ];

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
            Observed history
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-[var(--text)]">{metric.name} over time</h2>
        </div>
        <Link
          href="/data-workshop"
          className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
        >
          Review data →
        </Link>
      </div>

      <figure className="mt-4 rounded-xl border border-[var(--border)] bg-slate-50/60 p-3 sm:p-4">
        <div className="scroll-slim overflow-x-auto">
          <svg
            className="h-[260px] min-w-[640px] w-full"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={ariaParts.join(" ")}
          >
            <g transform={`translate(${PLOT_LEFT} ${PLOT_TOP})`}>
              {yTickValues.map((value) => {
                const y = yFrac(value, extent) * PLOT_HEIGHT;
                return (
                  <g key={value}>
                    <line
                      x1="0"
                      x2={PLOT_WIDTH}
                      y1={y}
                      y2={y}
                      stroke="var(--border)"
                      strokeWidth="1"
                    />
                    <text
                      x="-10"
                      y={y + 4}
                      textAnchor="end"
                      fill="var(--text-subtle)"
                      fontSize="10"
                    >
                      {formatReportMetricLevel(value, metric)}
                    </text>
                  </g>
                );
              })}

              {levels.map((level, index) => {
                const y = yFrac(level.value, extent) * PLOT_HEIGHT;
                const style = LEVEL_STYLE[level.kind];
                return (
                  <g key={level.kind}>
                    <line
                      x1="0"
                      x2={PLOT_WIDTH}
                      y1={y}
                      y2={y}
                      stroke={style.color}
                      strokeWidth="1.5"
                      strokeDasharray={style.dash}
                    />
                    <text
                      x={PLOT_WIDTH - 4}
                      y={y - 6 - index * 12}
                      textAnchor="end"
                      fill={style.color}
                      fontSize="10"
                      fontWeight="700"
                    >
                      {level.label} · {level.displayLabel}
                    </text>
                  </g>
                );
              })}

              {markers.map((marker, index) => {
                const x = xForIndex(indexOfDate(series, marker.date));
                const color = marker.isPrimary ? "var(--brand-amber)" : metric.color;
                return (
                  <g key={marker.actionId}>
                    <line
                      x1={x}
                      x2={x}
                      y1="0"
                      y2={PLOT_HEIGHT}
                      stroke={color}
                      strokeWidth={marker.isPrimary ? 2 : 1}
                      strokeDasharray={marker.isPrimary ? undefined : "3 4"}
                      opacity={marker.isPrimary ? 0.9 : 0.55}
                    />
                    <circle
                      cx={x}
                      cy="0"
                      r={marker.isPrimary ? 5 : 3.5}
                      fill={color}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                    <text
                      x={Math.min(PLOT_WIDTH - 18, Math.max(18, x))}
                      y={-10 - (index % 3) * 12}
                      textAnchor="middle"
                      fill={color}
                      fontSize="10"
                      fontWeight={marker.isPrimary ? "700" : "600"}
                    >
                      {marker.isPrimary ? `Primary · ${marker.label}` : marker.label}
                    </text>
                  </g>
                );
              })}

              <polyline
                points={points}
                fill="none"
                stroke={metric.color}
                strokeWidth="2.25"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {xTickIndexes.map((seriesIndex) => {
                const observation = series[seriesIndex];
                const x = xForIndex(seriesIndex);
                return (
                  <g key={`${observation.date}:${seriesIndex}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={PLOT_HEIGHT}
                      y2={PLOT_HEIGHT + 5}
                      stroke="var(--border-strong)"
                    />
                    <text
                      x={x}
                      y={PLOT_HEIGHT + 20}
                      textAnchor={seriesIndex === 0 ? "start" : seriesIndex === series.length - 1 ? "end" : "middle"}
                      fill="var(--text-subtle)"
                      fontSize="10"
                    >
                      {series.length > 70 ? formatMonthTick(observation.date) : formatShortDate(observation.date)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ background: metric.color }} aria-hidden="true" />
            Observed daily value
          </span>
          {levels.map((level) => (
            <span key={level.kind} className="inline-flex items-center gap-1.5">
              <span
                className="w-5 border-t border-dashed"
                style={{ borderColor: LEVEL_STYLE[level.kind].color }}
                aria-hidden="true"
              />
              {level.label} {level.displayLabel}
            </span>
          ))}
          {markers.some((marker) => marker.isPrimary) ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand-amber)]" aria-hidden="true" />
              Primary action
            </span>
          ) : null}
        </div>

        {markers.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Completed report actions on this timeline">
            {markers.map((marker) => (
              <li key={marker.actionId}>
                <Link
                  href={`/actions?selected=${encodeURIComponent(marker.actionId)}#${encodeURIComponent(marker.actionId)}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-[10px] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: marker.isPrimary ? "var(--brand-amber)" : metric.color }}
                    aria-hidden="true"
                  />
                  <span className="font-semibold">{marker.isPrimary ? "Primary" : "Support"} {marker.label}</span>
                  <time dateTime={marker.date} className="text-[var(--text-subtle)]">
                    {formatShortDate(marker.date)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <figcaption className="mt-3 border-t border-[var(--border)] pt-2 text-[10px] leading-4 text-[var(--text-muted)]">
          The line is observed history and is descriptive. Timing markers do not assign causality; the checked ITS estimate in this view is the causal readout.
        </figcaption>
      </figure>
    </Panel>
  );
}

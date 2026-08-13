import Link from "next/link";
import { formatMetricValue, formatShortDate } from "@/lib/format";
import type { MetricFormat } from "@/lib/types";
import type { SeriesFlag } from "@/components/charts/LineTimeSeries";
import { indexOfDate } from "@/components/charts/geometry";
import type {
  PreparedSeriesView,
  RateObservation,
} from "@/lib/metrics/series-controls";

const WIDTH = 1000;
const RATE_HEIGHT = 72;
const RATE_TOP = 8;
const RATE_BOTTOM = 66;
const LEVEL_HEIGHT = 52;
const LEVEL_TOP = 4;
const LEVEL_BOTTOM = 48;
const X_PAD = 10;

function xAt(index: number, length: number): number {
  if (length <= 1) return WIDTH / 2;
  return X_PAD + (index / (length - 1)) * (WIDTH - X_PAD * 2);
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function rateSegments(
  series: RateObservation[],
  maxMagnitude: number,
): string[] {
  const zero = (RATE_TOP + RATE_BOTTOM) / 2;
  const halfHeight = (RATE_BOTTOM - RATE_TOP) / 2;
  const segments: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) segments.push(current.join(" "));
    current = [];
  };

  series.forEach((point, index) => {
    if (point.value === null) {
      flush();
      return;
    }
    const y = zero - (point.value / maxMagnitude) * halfHeight * 0.86;
    current.push(`${xAt(index, series.length)},${y}`);
  });
  flush();
  return segments;
}

function lastRate(series: RateObservation[]): number | null {
  return series.at(-1)?.value ?? null;
}

export function VolumeChangeChart({
  view,
  color,
  format,
  flags = [],
}: {
  view: PreparedSeriesView;
  color: string;
  format: MetricFormat;
  flags?: SeriesFlag[];
}) {
  const rateValues = [...view.wow, ...view.mom].flatMap(({ value }) =>
    value === null ? [] : [Math.abs(value)],
  );
  const maxRate = Math.max(1, ...rateValues);
  const wowSegments = rateSegments(view.wow, maxRate);
  const momSegments = rateSegments(view.mom, maxRate);
  const values = view.levels.map(({ value }) => value);
  const levelMin = Math.min(0, ...values);
  const levelMax = Math.max(0, ...values);
  const levelSpan = levelMax - levelMin || 1;
  const levelY = (value: number) =>
    LEVEL_TOP + ((levelMax - value) / levelSpan) * (LEVEL_BOTTOM - LEVEL_TOP);
  const levelZero = levelY(0);
  const barWidth = Math.max(
    2,
    Math.min(14, (WIDTH - X_PAD * 2) / Math.max(1, view.levels.length) - 2),
  );
  const flagPositions = view.levels.length === 0
    ? []
    : flags.map((flag) => ({
      ...flag,
      index: indexOfDate(view.levels, flag.date),
    }));
  const latestLevel = view.levels.at(-1)?.value;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
          Change rate · zero centered
        </span>
        <div className="flex flex-wrap items-center gap-3 tabular-nums">
          <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
            <span className="h-0.5 w-3 bg-[var(--brand-blue)]" aria-hidden="true" />
            WoW <strong className="text-[var(--text)]">{formatRate(lastRate(view.wow))}</strong>
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
            <span className="w-3 border-t-2 border-dashed border-[var(--brand-amber)]" aria-hidden="true" />
            MoM <strong className="text-[var(--text)]">{formatRate(lastRate(view.mom))}</strong>
          </span>
        </div>
      </div>

      <div className="relative pt-4">
        <svg
          className="h-[72px] w-full"
          viewBox={`0 0 ${WIDTH} ${RATE_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Week-over-week and month-over-month change rates"
        >
          <line x1={X_PAD} x2={WIDTH - X_PAD} y1={(RATE_TOP + RATE_BOTTOM) / 2} y2={(RATE_TOP + RATE_BOTTOM) / 2} stroke="var(--border-strong)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          {flagPositions.map((flag) => (
            <line key={`rate:${flag.date}:${flag.label}`} x1={xAt(flag.index, view.levels.length)} x2={xAt(flag.index, view.levels.length)} y1={RATE_TOP} y2={RATE_BOTTOM} stroke={flag.color ?? color} strokeWidth="1" strokeDasharray="3 3" opacity="0.45" vectorEffect="non-scaling-stroke" />
          ))}
          {wowSegments.map((points, index) => (
            <polyline key={`wow:${index}`} points={points} fill="none" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
          {momSegments.map((points, index) => (
            <polyline key={`mom:${index}`} points={points} fill="none" stroke="var(--brand-amber)" strokeWidth="2" strokeDasharray="6 3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {flagPositions.map((flag) => flag.href ? (
          <Link
            key={`${flag.date}:${flag.label}:link`}
            href={flag.href}
            title={flag.title}
            aria-label={flag.title ? `${flag.label}: ${flag.title}` : flag.label}
            className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border bg-[var(--surface)] px-1.5 py-0.5 text-[9px] font-semibold shadow-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              left: `${(xAt(flag.index, view.levels.length) / WIDTH) * 100}%`,
              borderColor: flag.color ?? color,
              color: flag.color ?? color,
            }}
          >
            {flag.label}
          </Link>
        ) : null)}
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Metric level</span>
        <span className="tabular-nums text-[var(--text-muted)]">
          Current <strong className="text-[var(--text)]">{latestLevel === undefined ? "—" : formatMetricValue(latestLevel, format)}</strong>
        </span>
      </div>
      <svg
        className="h-[52px] w-full"
        viewBox={`0 0 ${WIDTH} ${LEVEL_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Metric level bars"
      >
        <line x1={X_PAD} x2={WIDTH - X_PAD} y1={levelZero} y2={levelZero} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {view.levels.map((point, index) => {
          const y = levelY(point.value);
          return (
            <rect
              key={point.date}
              x={xAt(index, view.levels.length) - barWidth / 2}
              y={Math.min(y, levelZero)}
              width={barWidth}
              height={Math.max(1, Math.abs(levelZero - y))}
              fill={color}
              opacity="0.3"
            />
          );
        })}
        {flagPositions.map((flag) => (
          <line key={`level:${flag.date}:${flag.label}`} x1={xAt(flag.index, view.levels.length)} x2={xAt(flag.index, view.levels.length)} y1={LEVEL_TOP} y2={LEVEL_BOTTOM} stroke={flag.color ?? color} strokeWidth="1" strokeDasharray="3 3" opacity="0.45" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <div className="flex justify-between text-[9px] text-[var(--text-subtle)]">
        <span>{view.levels[0] ? formatShortDate(view.levels[0].date) : "No data"}</span>
        <span>{view.levels.at(-1) ? formatShortDate(view.levels.at(-1)!.date) : ""}</span>
      </div>
    </div>
  );
}

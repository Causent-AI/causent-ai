import type { Observation } from "@/lib/types";

export type SeriesRange = "30d" | "60d" | "90d" | "all";
export type SeriesCadence = "daily" | "weekly";
export type ChangeComparison = "wow" | "mom";

export type RateObservation = {
  date: string;
  value: number | null;
};

export type PreparedSeriesView = {
  levels: Observation[];
  wow: RateObservation[];
  mom: RateObservation[];
};

const RANGE_DAYS: Record<Exclude<SeriesRange, "all">, number> = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

function isoDateAtOffset(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Shift by whole calendar months, clamping month-end dates (Mar 31 -> Feb 28). */
function isoDateAtMonthOffset(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function mondayOfWeek(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function filterSeriesRange(series: Observation[], range: SeriesRange): Observation[] {
  if (series.length === 0 || range === "all") return series;
  const end = series[series.length - 1].date;
  const start = isoDateAtOffset(end, -(RANGE_DAYS[range] - 1));
  return series.filter((observation) => observation.date >= start && observation.date <= end);
}

export function rollupSeries(
  series: Observation[],
  cadence: SeriesCadence,
): Observation[] {
  if (cadence === "daily") return series;
  const buckets = new Map<string, { total: number; count: number }>();
  for (const observation of series) {
    const date = mondayOfWeek(observation.date);
    const bucket = buckets.get(date) ?? { total: 0, count: 0 };
    bucket.total += observation.value;
    bucket.count += 1;
    buckets.set(date, bucket);
  }
  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    value: bucket.total / bucket.count,
  }));
}

function baselineDate(
  date: string,
  comparison: ChangeComparison,
  cadence: SeriesCadence,
): string {
  const shifted = comparison === "wow"
    ? isoDateAtOffset(date, -7)
    : isoDateAtMonthOffset(date, -1);
  return cadence === "weekly" ? mondayOfWeek(shifted) : shifted;
}

/**
 * Percent change against an exact calendar baseline. Missing dates and zero
 * denominators are gaps, never silently replaced with a nearby observation.
 */
export function calculateChangeSeries(
  series: Observation[],
  comparison: ChangeComparison,
  cadence: SeriesCadence,
): RateObservation[] {
  const valueByDate = new Map(series.map((observation) => [observation.date, observation.value]));
  return series.map((observation) => {
    const baseline = valueByDate.get(baselineDate(observation.date, comparison, cadence));
    return {
      date: observation.date,
      value: baseline === undefined || baseline === 0
        ? null
        : ((observation.value - baseline) / Math.abs(baseline)) * 100,
    };
  });
}

function overlapsRange(
  date: string,
  cadence: SeriesCadence,
  start: string,
  end: string,
): boolean {
  const bucketEnd = cadence === "weekly" ? isoDateAtOffset(date, 6) : date;
  return date <= end && bucketEnd >= start;
}

/**
 * Build the shared chart view. Rollup and both comparison series are derived
 * from full history before the visible date window is applied, so the first
 * rendered point can still use a baseline immediately before that window.
 */
export function prepareSeriesView(
  series: Observation[],
  range: SeriesRange,
  cadence: SeriesCadence,
): PreparedSeriesView {
  if (series.length === 0) return { levels: [], wow: [], mom: [] };

  const fullLevels = rollupSeries(series, cadence);
  const fullWow = calculateChangeSeries(fullLevels, "wow", cadence);
  const fullMom = calculateChangeSeries(fullLevels, "mom", cadence);
  if (range === "all") {
    return { levels: fullLevels, wow: fullWow, mom: fullMom };
  }

  const end = series[series.length - 1].date;
  const start = isoDateAtOffset(end, -(RANGE_DAYS[range] - 1));
  const visibleDates = new Set(
    fullLevels
      .filter((observation) => overlapsRange(observation.date, cadence, start, end))
      .map((observation) => observation.date),
  );
  return {
    levels: fullLevels.filter((observation) => visibleDates.has(observation.date)),
    wow: fullWow.filter((observation) => visibleDates.has(observation.date)),
    mom: fullMom.filter((observation) => visibleDates.has(observation.date)),
  };
}

export function prepareSeries(
  series: Observation[],
  range: SeriesRange,
  cadence: SeriesCadence,
): Observation[] {
  return prepareSeriesView(series, range, cadence).levels;
}

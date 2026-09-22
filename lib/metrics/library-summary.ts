import type { Observation } from "../types.ts";

/** Calendar windows end at the last observation; missing days are never zeros. */
export function metricLibrarySummary(series: Observation[]) {
  const latest = series.at(-1);
  if (!latest) return { latest: null, average: null, wow: null };
  const end = Date.parse(latest.date);
  const values = new Map(series.map((point) => [point.date, point.value]));
  const window = (offset: number, length: number) =>
    Array.from({ length }, (_, i) =>
      values.get(
        new Date(end - (offset + i) * 86_400_000).toISOString().slice(0, 10),
      ),
    );
  const mean = (points: Array<number | undefined>) =>
    points.every((v) => v !== undefined && Number.isFinite(v))
      ? (points as number[]).reduce((a, b) => a + b, 0) / points.length
      : null;
  const current = mean(window(0, 7));
  const previous = mean(window(7, 7));
  return {
    latest: latest.value,
    average: mean(window(0, 28)),
    wow:
      current !== null && previous !== null && previous > 0
        ? ((current - previous) / previous) * 100
        : null,
  };
}

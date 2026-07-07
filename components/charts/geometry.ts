import type { Observation } from "@/lib/types";

export type Extent = { min: number; max: number };

/** Padded value extent so the line never hugs the top/bottom edge. */
export function paddedExtent(values: number[], padFrac = 0.12): Extent {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  return { min: min - span * padFrac, max: max + span * padFrac };
}

/** Map a value to a 0..1 vertical fraction (0 = top of plot). */
export function yFrac(value: number, { min, max }: Extent): number {
  if (max === min) return 0.5;
  return 1 - (value - min) / (max - min);
}

/** SVG polyline `points` string across a fixed 0..W × 0..H viewBox. */
export function linePoints(
  series: Observation[],
  extent: Extent,
  width = 1000,
  height = 100,
): string {
  const n = series.length;
  return series
    .map((o, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * width;
      const y = yFrac(o.value, extent) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Index of the series point nearest a given ISO date (for flag placement). */
export function indexOfDate(series: Observation[], iso: string): number {
  const exact = series.findIndex((o) => o.date === iso);
  if (exact >= 0) return exact;
  // fall back to nearest by lexical date compare (ISO sorts chronologically)
  let best = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i].date <= iso) best = i;
  }
  return best;
}

/** Even sampling of `count` tick indices across a series length. */
export function tickIndices(length: number, count: number): number[] {
  if (length <= 1) return [0];
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

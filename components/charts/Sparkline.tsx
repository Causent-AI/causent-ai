import type { Observation } from "@/lib/types";
import { linePoints, paddedExtent } from "@/components/charts/geometry";

/** Tiny axis-less trend line for summary rows. */
export function Sparkline({
  series,
  color,
  width = 116,
  height = 34,
  strokeWidth = 1.75,
}: {
  series: Observation[];
  color: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  const extent = paddedExtent(series.map((o) => o.value), 0.18);
  const points = linePoints(series, extent, 1000, 100);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

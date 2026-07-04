import type { MetricImpact } from "@/lib/types";
import { formatCurrencyDelta } from "@/lib/format";
import { metricById } from "@/lib/seed";

// Horizontal diverging bar chart: each metric's net impact, positive to the
// right (teal) and negative to the left (red). Direction is reinforced by the
// signed value label at each bar tip, so it never reads by color alone.

function niceTicks(min: number, max: number, count = 7): number[] {
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

export function ImpactBar({ rows }: { rows: MetricImpact[] }) {
  const values = rows.map((r) => r.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const pad = (rawMax - rawMin) * 0.08 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const frac = (v: number) => ((v - min) / (max - min)) * 100;
  const zero = frac(0);
  const ticks = niceTicks(min, max);

  return (
    <div className="w-full">
      {/* legend */}
      <div className="mb-3 flex items-center justify-end gap-6 text-[11px] font-medium">
        <span className="text-[var(--neg)]">Negative Impact ←</span>
        <span className="text-[var(--pos)]">→ Positive Impact</span>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const metric = metricById(r.metricId);
          const pos = r.value >= 0;
          const barColor = r.good ? "var(--pos)" : "var(--neg)";
          const left = Math.min(frac(r.value), zero);
          const width = Math.abs(frac(r.value) - zero);
          return (
            <div key={r.metricId} className="flex items-center">
              <div className="w-[112px] shrink-0 pr-3 text-right text-[13px] text-[var(--text)]">
                {metric?.name}
              </div>
              <div className="relative h-6 flex-1">
                {/* zero baseline */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-[var(--border-strong)]"
                  style={{ left: `${zero}%` }}
                />
                {/* bar */}
                <div
                  className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[3px]"
                  style={{ left: `${left}%`, width: `${width}%`, background: barColor }}
                />
                {/* value label at tip */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-[12px] font-semibold tabular-nums"
                  style={{
                    left: pos ? `calc(${left + width}% + 6px)` : undefined,
                    right: pos ? undefined : `calc(${100 - left}% + 6px)`,
                    color: barColor,
                  }}
                >
                  {r.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* value axis */}
      <div className="mt-2 flex items-center">
        <div className="w-[112px] shrink-0" />
        <div className="relative h-4 flex-1">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute -translate-x-1/2 text-[10px] text-[var(--text-subtle)] tabular-nums"
              style={{ left: `${frac(t)}%` }}
            >
              {formatCurrencyDelta(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

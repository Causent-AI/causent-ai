import type { ImpactStat } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";

const TONE: Record<ImpactStat["tone"], string> = {
  positive: "text-[var(--pos)]",
  negative: "text-[var(--neg)]",
  neutral: "text-[var(--text-muted)]",
  plain: "text-[var(--text)]",
};

export function AggregatedImpact({ stats }: { stats: ImpactStat[] }) {
  return (
    <Panel>
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">
          Aggregated Impact
        </h2>
        <span className="text-[12px] text-[var(--text-muted)]">
          (Last 30 Days vs Prior 30 Days)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--border)] px-3 py-3"
          >
            <div className="text-[11px] font-medium text-[var(--text-muted)]">
              {s.label}
            </div>
            <div
              className={`mt-1.5 text-[26px] font-bold leading-none tabular-nums ${TONE[s.tone]}`}
            >
              {s.value}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-subtle)] tabular-nums">
              <span>{s.comparison}</span>
              {s.change && (
                <span className="font-semibold text-[var(--pos)]">{s.change}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

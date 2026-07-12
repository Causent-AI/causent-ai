"use client";

import type { Decision, Metric } from "@/lib/types";
import { VerdictBadge } from "@/components/actions/VerdictBadge";

// Left-panel list of decisions (the intent layer). Each card shows the title,
// its predictions' verdict chips, and the lever state. Click-to-select.

export function DecisionList({
  decisions,
  metrics,
  selectedId,
  onSelect,
}: {
  decisions: Decision[];
  metrics: Metric[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  return (
    // No inner scroll container: the parent Panel owns scrolling, and a nested
    // overflow-y-auto collapses to 0 height inside the height-constrained panel.
    <ul className="flex shrink-0 flex-col gap-1" role="listbox" aria-label="Decisions">
      {decisions.map((d) => {
        const selected = d.id === selectedId;
        return (
          <li key={d.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(d.id)}
              className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-[var(--text)]/25 bg-[var(--bg)]"
                  : "border-transparent hover:bg-[var(--bg)]/60"
              }`}
            >
              <div className="truncate text-[13px] font-semibold text-[var(--text)]">
                {d.title}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {d.predictions.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1">
                    {p.verdict ? (
                      <VerdictBadge verdict={p.verdict} />
                    ) : (
                      <span className="text-[11px] text-[var(--text-subtle)]">committed</span>
                    )}
                    <span className="text-[11px] text-[var(--text-subtle)]">
                      {metricById.get(p.metricId)?.name ?? p.metricId}
                    </span>
                  </span>
                ))}
                {d.leverActionId === null && (
                  <span className="text-[11px] text-[var(--neg)]">no lever</span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

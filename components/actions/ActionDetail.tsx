import type { Action, Metric } from "@/lib/types";
import { Delta } from "@/components/ui/Delta";

// Slim detail for an action selected on its own (an unassigned action, or a
// drill-down from a decision). Replaces the retired DecisionEditor — the
// rationale now lives on the DECISION; what remains here is the action's
// identity, ship state, and honest per-metric readout.

export function ActionDetail({
  action,
  metrics,
}: {
  action: Action;
  metrics: Metric[];
}) {
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
            {action.title}
          </h2>
          <span className="text-[14px] tabular-nums text-[var(--text-subtle)]">
            #{action.pr}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-[var(--text-subtle)]">
          {action.shippedAt ? `Shipped ${action.shippedAt}` : "Not shipped"}
        </p>
      </div>

      {action.rationale && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-[var(--text)]">
            {action.rationale.hypothesis}
          </p>
          {action.rationale.body.map((para, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              {para}
            </p>
          ))}
        </div>
      )}

      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
          Measured impact (confident causal claims only)
        </h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {action.impact.map((c) => {
            const m = metricById.get(c.metricId);
            return (
              <li key={c.metricId} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: m?.color }}
                    aria-hidden="true"
                  />
                  {m?.name ?? c.metricId}
                </span>
                <Delta direction={c.direction} label={c.label} good={c.good} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

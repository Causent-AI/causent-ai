import type { Action, Decision, Metric } from "@/lib/types";
import { Delta } from "@/components/ui/Delta";

// The deliberately-small graph: decision → lever → predicted metric(s), rendered
// as linked chips so the estimated-outcomes readout isn't a wall of text. This is
// the ledger-card treatment from the decision-graph design — a provenance chain
// read forward — NOT a graph centerpiece (the "hairball trap").

function Arrow() {
  return (
    <svg
      width="16"
      height="8"
      viewBox="0 0 16 8"
      aria-hidden="true"
      className="shrink-0 text-[var(--text-subtle)]"
    >
      <path
        d="M0 4h13M10 1l3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function Chip({
  children,
  dashed = false,
}: {
  children: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <span
      className={`inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-md border px-2 py-1 text-[12px] ${
        dashed
          ? "border-dashed border-[var(--border-strong)] text-[var(--text-subtle)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
      }`}
    >
      {children}
    </span>
  );
}

export function MechanismChain({
  decision,
  actions,
  metrics,
}: {
  decision: Decision;
  actions: Action[];
  metrics: Metric[];
}) {
  if (decision.predictions.length === 0) return null;

  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const lever = actions.find((a) => a.id === decision.leverActionId) ?? null;
  const supportingCount = decision.actionIds.filter(
    (id) => id !== decision.leverActionId
  ).length;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <Chip>Decision</Chip>
      <Arrow />
      {lever ? (
        <Chip>
          <span className="tabular-nums text-[var(--text-muted)]">#{lever.pr}</span>
          <span className="truncate">{lever.title}</span>
        </Chip>
      ) : (
        <Chip dashed>no lever mapped</Chip>
      )}
      {supportingCount > 0 && (
        <span className="text-[11px] text-[var(--text-subtle)]">
          +{supportingCount} supporting
        </span>
      )}
      <Arrow />
      <span className="flex flex-col gap-1">
        {decision.predictions.map((p) => {
          const metric = metricById.get(p.metricId);
          const dirUp = p.direction === "POSITIVE";
          const good = metric ? dirUp === metric.higherIsBetter : dirUp;
          return (
            <Chip key={p.id}>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: metric?.color }}
                aria-hidden="true"
              />
              <span className="truncate">{metric?.name ?? p.metricId}</span>
              <Delta
                direction={dirUp ? "up" : "down"}
                label={`${dirUp ? "+" : "−"}${p.magnitudePctMean}%`}
                good={good}
                size="xs"
              />
            </Chip>
          );
        })}
      </span>
    </div>
  );
}

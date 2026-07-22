import type { MetricProjection } from "@/lib/decision-reports/schema";

export function MetricPredictionChart({ projection }: { projection: MetricProjection }) {
  const delta = projection.predictedPct - projection.baselinePct;
  const max = Math.max(100, projection.baselinePct, projection.predictedPct);

  return (
    <figure className="rounded-xl border border-[var(--border)] bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            Core metric hypothesis
          </p>
          <h3 className="mt-1 text-[15px] font-semibold text-[var(--text)]">
            {projection.metricName}
          </h3>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{projection.definition}</p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">
          Illustrative—not observed
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <MetricBar
          label={projection.baselineLabel}
          value={projection.baselinePct}
          max={max}
          color="var(--text-muted)"
        />
        <MetricBar
          label={projection.predictionLabel}
          value={projection.predictedPct}
          max={max}
          color="var(--brand-teal)"
        />
      </div>

      <figcaption className="mt-4 flex items-start gap-3 border-t border-[var(--border)] pt-3">
        <span className="rounded bg-teal-50 px-2 py-1 text-[13px] font-semibold tabular-nums text-[var(--pos)]">
          +{delta}pp
        </span>
        <p className="text-[11px] leading-5 text-[var(--text-muted)]">
          Founder prediction for the prototype. Replace both values with instrumented data before using this report to approve the decision.
        </p>
      </figcaption>
    </figure>
  );
}

function MetricBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-[var(--text-muted)]">{label}</span>
        <span className="font-semibold tabular-nums text-[var(--text)]">{value}%</span>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full bg-slate-200"
        role="img"
        aria-label={`${label}: ${value}%`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / max) * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

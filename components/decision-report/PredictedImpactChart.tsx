import type { MetricProjection } from "@/lib/decision-reports/schema";

function percent(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function PredictedImpactChart({
  projection,
  statusLabel = "Human confirmation required",
}: {
  projection: MetricProjection;
  statusLabel?: string;
}) {
  const baseline = projection.baselinePct;
  const predicted = projection.predictedPct;
  if (baseline === null || predicted === null) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-5">
        <p className="text-[12px] font-semibold text-[var(--text)]">Predicted impact</p>
        <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
          Confirm a baseline and human prediction during activation to populate this chart.
        </p>
      </div>
    );
  }

  const maxValue = Math.max(100, baseline, predicted);
  const y = (value: number) => 92 - (value / maxValue) * 72;
  const baselineY = y(baseline);
  const predictedY = y(predicted);
  const lift = predicted - baseline;

  return (
    <figure className="rounded-xl border border-[var(--border)] bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">Predicted impact</p>
          <h3 className="mt-1 text-[15px] font-semibold text-[var(--text)]">{projection.metricName}</h3>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-800">
          {statusLabel}
        </span>
      </div>
      <svg className="mt-4 h-44 w-full" viewBox="0 0 700 150" role="img" aria-label={`${projection.metricName}: ${percent(baseline)} baseline and ${percent(predicted)} predicted`}>
        <line x1="45" x2="660" y1="92" y2="92" stroke="var(--border-strong)" strokeWidth="1" />
        <line x1="360" x2="360" y1="12" y2="112" stroke="var(--brand-blue)" strokeDasharray="4 4" opacity="0.65" />
        <polygon points={`360,${baselineY} 650,${baselineY} 650,${predictedY}`} fill="var(--brand-teal)" opacity="0.12" />
        <polyline points={`55,${baselineY} 360,${baselineY} 650,${baselineY}`} fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="6 5" />
        <polyline points={`55,${baselineY} 360,${baselineY} 650,${predictedY}`} fill="none" stroke="var(--brand-teal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="55" cy={baselineY} r="4" fill="var(--text-muted)" />
        <circle cx="650" cy={predictedY} r="5" fill="var(--brand-teal)" />
        <line x1="672" x2="672" y1={Math.min(baselineY, predictedY)} y2={Math.max(baselineY, predictedY)} stroke="var(--brand-teal)" strokeWidth="2" />
        <line x1="666" x2="678" y1={baselineY} y2={baselineY} stroke="var(--brand-teal)" strokeWidth="2" />
        <line x1="666" x2="678" y1={predictedY} y2={predictedY} stroke="var(--brand-teal)" strokeWidth="2" />
        <text x="55" y={baselineY - 10} fill="var(--text)" fontSize="12" fontWeight="600">{percent(baseline)} baseline</text>
        <text x="650" y={predictedY - 10} textAnchor="end" fill="var(--brand-teal)" fontSize="12" fontWeight="700">{percent(predicted)} predicted</text>
        <text x="360" y="128" textAnchor="middle" fill="var(--brand-blue)" fontSize="11" fontWeight="600">Intervention</text>
        <text x="650" y={baselineY + 16} textAnchor="end" fill="var(--text-muted)" fontSize="10">Expected baseline</text>
        <text x="688" y={(baselineY + predictedY) / 2 + 4} fill="var(--brand-teal)" fontSize="11" fontWeight="700">{lift >= 0 ? "+" : ""}{lift.toFixed(1)}pp</text>
      </svg>
      <figcaption className="text-[11px] leading-5 text-[var(--text-muted)]">
        The gap shows the pre-registered prediction versus the expected baseline—not a measured result.
      </figcaption>
    </figure>
  );
}

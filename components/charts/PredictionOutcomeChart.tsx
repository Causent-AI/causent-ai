import type { PredictionOutcomeViewModel } from "@/lib/scorecard-chart";
import { formatSignedPredictionPct } from "@/lib/scorecard-chart";

function statusClasses(state: PredictionOutcomeViewModel["state"]): string {
  if (state === "measured") {
    return "border-teal-200 bg-teal-50 text-teal-900";
  }
  if (state === "no-signal") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-[var(--border)] bg-slate-50 text-[var(--text-muted)]";
}

export function PredictionOutcomeChart({
  viewModel,
}: {
  viewModel: PredictionOutcomeViewModel;
}) {
  const {
    axis,
    ci95Label,
    ci95Pct,
    hasMeasurement,
    measuredLabel,
    measuredPct,
    metricName,
    plannedLabel,
    plannedPct,
    state,
    statusDetail,
    statusTitle,
  } = viewModel;

  const markerColor = state === "measured" ? "var(--brand-teal)" : "var(--text-muted)";
  const plotLeft = 94;
  const plotRight = 686;
  const plotWidth = plotRight - plotLeft;
  const x = (value: number) =>
    plotLeft + ((value - axis.minPct) / (axis.maxPct - axis.minPct)) * plotWidth;
  const zeroX = x(0);

  return (
    <figure className="rounded-xl border border-[var(--border)] bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            Prediction outcome
          </p>
          <h3 className="mt-1 text-[15px] font-semibold text-[var(--text)]">{metricName}</h3>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClasses(state)}`}>
          {statusTitle}
        </span>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">
        {statusDetail}
      </p>

      {plannedPct === null ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-5">
          <p className="text-[12px] font-semibold text-[var(--text)]">No comparison available</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
            The activation-time commitment is missing, so Causent cannot construct an outcome comparison.
          </p>
        </div>
      ) : !hasMeasurement || measuredPct === null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
              Activation-time commitment
            </p>
            <p className="mt-2 text-[22px] font-semibold tabular-nums text-blue-950">
              {plannedLabel}
            </p>
            <p className="mt-1 text-[11px] text-blue-900/80">Signed percent of metric mean</p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-3">
            <p className="text-[12px] font-semibold text-[var(--text)]">No numeric outcome to graph</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
              No zero has been substituted. The comparison will appear only when the engine records a measured estimate.
            </p>
          </div>
        </div>
      ) : (
        <>
          <svg
            className="mt-4 h-52 w-full"
            viewBox="0 0 720 210"
            role="img"
            aria-label={viewModel.ariaLabel}
          >
            <line x1={plotLeft} x2={plotRight} y1="169" y2="169" stroke="var(--border-strong)" strokeWidth="1" />
            <line x1={plotLeft} x2={plotRight} y1="61" y2="61" stroke="var(--border)" strokeWidth="1" />
            <line x1={plotLeft} x2={plotRight} y1="117" y2="117" stroke="var(--border)" strokeWidth="1" />
            <line x1={zeroX} x2={zeroX} y1="32" y2="173" stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth="1.5" />

            <text x="12" y="65" fill="var(--text)" fontSize="12" fontWeight="600">Plan</text>
            <text x="12" y="121" fill="var(--text)" fontSize="12" fontWeight="600">Outcome</text>

            <polygon
              points={`${x(plannedPct)},53 ${x(plannedPct) + 8},61 ${x(plannedPct)},69 ${x(plannedPct) - 8},61`}
              fill="var(--brand-blue)"
            />
            <text
              x={x(plannedPct)}
              y="44"
              textAnchor="middle"
              fill="var(--brand-blue)"
              fontSize="12"
              fontWeight="700"
            >
              {plannedLabel}
            </text>

            {ci95Pct ? (
              <>
                <line x1={x(ci95Pct.low)} x2={x(ci95Pct.high)} y1="117" y2="117" stroke={markerColor} strokeWidth="5" strokeLinecap="round" opacity="0.48" />
                <line x1={x(ci95Pct.low)} x2={x(ci95Pct.low)} y1="108" y2="126" stroke={markerColor} strokeWidth="2" />
                <line x1={x(ci95Pct.high)} x2={x(ci95Pct.high)} y1="108" y2="126" stroke={markerColor} strokeWidth="2" />
              </>
            ) : null}
            <circle cx={x(measuredPct)} cy="117" r="7" fill={markerColor} stroke="white" strokeWidth="2" />
            <text
              x={x(measuredPct)}
              y="99"
              textAnchor="middle"
              fill={markerColor}
              fontSize="12"
              fontWeight="700"
            >
              {measuredLabel}
            </text>

            <line x1={plotLeft} x2={plotLeft} y1="166" y2="174" stroke="var(--border-strong)" />
            <line x1={plotRight} x2={plotRight} y1="166" y2="174" stroke="var(--border-strong)" />
            <text x={plotLeft} y="188" textAnchor="start" fill="var(--text-subtle)" fontSize="10">
              {formatSignedPredictionPct(axis.minPct)}
            </text>
            <text x={zeroX} y="188" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontWeight="600">0.0%</text>
            <text x={plotRight} y="188" textAnchor="end" fill="var(--text-subtle)" fontSize="10">
              {formatSignedPredictionPct(axis.maxPct)}
            </text>
            <text x={(plotLeft + plotRight) / 2} y="205" textAnchor="middle" fill="var(--text-muted)" fontSize="10">
              Signed change (% of pre-intervention mean)
            </text>
          </svg>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
            <span>◆ Plan commitment&nbsp;&nbsp;● Engine estimate</span>
            <span className="tabular-nums">{ci95Label ?? "95% CI not available"}</span>
          </div>
        </>
      )}
    </figure>
  );
}

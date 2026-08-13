import Link from "next/link";

import { ReportImpactTimeline } from "@/components/charts/ReportImpactTimeline";
import { PredictionPanel } from "@/components/impact/PredictionPanel";
import { Panel } from "@/components/ui/Panel";
import type { MetricProjection } from "@/lib/decision-reports/schema";
import { formatLongDate } from "@/lib/format";
import {
  buildReportImpactViewModel,
  type ReportImpactActionState,
} from "@/lib/impact/report-impact";
import type { Action, Decision, Metric } from "@/lib/types";

function stateClasses(state: ReportImpactActionState): string {
  if (state === "measured") return "border-teal-200 bg-teal-50 text-teal-900";
  if (state === "preliminary") return "border-blue-200 bg-blue-50 text-blue-900";
  if (state === "gathering") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-[var(--border)] bg-slate-50 text-[var(--text-muted)]";
}

function predictionStateClasses(
  state: "measured" | "unresolved" | "no-signal",
): string {
  if (state === "measured") return "border-teal-200 bg-teal-50 text-teal-900";
  if (state === "no-signal") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-[var(--border)] bg-slate-50 text-[var(--text-muted)]";
}

export function ReportImpactOverview({
  reportTitle,
  decision,
  predictionId,
  projection,
  metric,
  actions,
}: {
  reportTitle: string;
  decision: Decision;
  predictionId: string | null;
  projection: MetricProjection;
  metric: Metric;
  actions: Action[];
}) {
  const view = buildReportImpactViewModel({
    reportTitle,
    decision,
    predictionId,
    projection,
    metric,
    actions,
  });
  const observationDetail = view.nPre !== null && view.nPost !== null
    ? `${view.nPre} pre · ${view.nPost} post`
    : `${view.observationCount} connected daily observations`;
  const confidentMeasurement = view.predictionState === "measured";

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
              Decision outcome
            </p>
            <h1 className="mt-1 text-[19px] font-semibold tracking-tight text-[var(--text)]">
              {view.reportTitle}
            </h1>
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
              {view.decisionTitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-semibold text-teal-900">
              {view.metricName}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${predictionStateClasses(view.predictionState)}`}>
              {view.predictionStatus}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">Plan</p>
            <p className="mt-2 text-[22px] font-semibold tabular-nums text-blue-950">{view.plannedLabel}</p>
            <p className="mt-1 text-[10px] leading-4 text-blue-900/75">Human commitment · signed % of baseline</p>
          </div>
          <div className={`rounded-xl border p-3 ${confidentMeasurement ? "border-teal-200 bg-teal-50/60" : view.hasMeasurement ? "border-amber-200 bg-amber-50/60" : "border-[var(--border)] bg-slate-50"}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${confidentMeasurement ? "text-teal-800" : view.hasMeasurement ? "text-amber-800" : "text-[var(--text-subtle)]"}`}>
              Measured estimate
            </p>
            <p className={`mt-2 text-[22px] font-semibold tabular-nums ${confidentMeasurement ? "text-teal-950" : view.hasMeasurement ? "text-amber-950" : "text-[var(--text)]"}`}>
              {view.measuredLabel}
            </p>
            <p className={`mt-1 text-[10px] leading-4 ${confidentMeasurement ? "text-teal-900/75" : view.hasMeasurement ? "text-amber-900/75" : "text-[var(--text-muted)]"}`}>
              {view.hasMeasurement
                ? confidentMeasurement
                  ? "Engine estimate · signed % of baseline"
                  : "Context only · not a confident causal result"
                : "No numeric outcome substituted"}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Plan variance</p>
            <p className="mt-2 text-[22px] font-semibold tabular-nums text-[var(--text)]">{view.varianceLabel}</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">Estimate minus plan · same %-of-baseline scale</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Analysis sample</p>
            <p className="mt-2 text-[22px] font-semibold tabular-nums text-[var(--text)]">{view.analysisObservationCount}</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{observationDetail}</p>
          </div>
          <div className="col-span-2 rounded-xl border border-[var(--border)] bg-slate-50 p-3 lg:col-span-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Actions complete</p>
            <p className="mt-2 text-[22px] font-semibold tabular-nums text-[var(--text)]">
              {view.completedActions}/{view.plannedActions}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
              {view.primaryActionId ? "1 pre-registered primary lever" : "No primary lever registered"}
            </p>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">
          {view.predictionDetail}
        </p>
      </Panel>

      <PredictionPanel
        decision={decision}
        predictionId={predictionId}
        projection={projection}
        metric={metric}
      />

      <ReportImpactTimeline
        metric={metric}
        actions={actions}
        primaryActionId={view.primaryActionId}
        levels={view.timelineLevels}
      />

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text)]">Action-to-metric trace</h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[var(--text-muted)]">
              Every report action stays connected to {view.metricName}. Only the pre-registered primary lever receives an action-level causal readout; support actions are not independently credited.
            </p>
          </div>
          <Link
            href="/actions"
            className="min-h-9 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
          >
            Open actions →
          </Link>
        </div>

        <ol className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {view.actionTraces.map((trace) => (
            <li key={trace.actionId} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(170px,0.65fr)_minmax(190px,0.75fr)] lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
                    {trace.displayCode}
                  </span>
                  {trace.isPrimary ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                      Primary lever
                    </span>
                  ) : (
                    <span className="rounded-full border border-[var(--border)] bg-slate-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                      Support action
                    </span>
                  )}
                </div>
                <Link
                  href={trace.href}
                  className="mt-2 block truncate text-[13px] font-semibold text-[var(--brand-blue)] hover:underline"
                >
                  {trace.title}
                </Link>
                <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
                  {trace.completedOn ? `Completed ${formatLongDate(trace.completedOn)}` : "Completion date not recorded"}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Metric link</p>
                <p className="mt-1 text-[12px] font-semibold text-[var(--text)]">{view.metricName}</p>
                <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[9px] font-semibold ${stateClasses(trace.state)}`}>
                  {trace.stateLabel}
                </span>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-slate-50/70 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Estimated contribution</p>
                  <p className="text-[16px] font-semibold tabular-nums text-[var(--text)]">{trace.impactLabel}</p>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{trace.detail}</p>
                {trace.ci95Label || trace.sampleLabel ? (
                  <p className="mt-2 text-[9px] font-medium tabular-nums text-[var(--text-subtle)]">
                    {[trace.ci95Label, trace.sampleLabel].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

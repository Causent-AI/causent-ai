import Link from "next/link";

import { ReportImpactTimeline } from "@/components/charts/ReportImpactTimeline";
import { PredictionPanel } from "@/components/impact/PredictionPanel";
import type { MetricProjection } from "@/lib/decision-reports/schema";
import { formatLongDate } from "@/lib/format";
import { buildReportImpactViewModel } from "@/lib/impact/report-impact";
import type { Action, Decision, Metric } from "@/lib/types";

export function ReportImpactOverview({
  reportTitle,
  decision,
  predictionId,
  projection,
  metric,
  metrics,
  actions,
}: {
  reportTitle: string;
  decision: Decision;
  predictionId: string | null;
  projection: MetricProjection;
  metric: Metric;
  metrics: Metric[];
  actions: Action[];
}) {
  const view = buildReportImpactViewModel({
    reportTitle,
    decision,
    predictionId,
    projection,
    metric,
    metrics,
    actions,
  });
  const primary = view.actionTraces.find((trace) => trace.isPrimary);
  return (
    <>
      <header className="impact-heading">
        <div>
          <h1>Impact</h1>
          <p>
            {view.reportTitle} · {view.metricName}
          </p>
        </div>
        <label>
          Model
          <select aria-label="Impact model" value="its" disabled>
            <option value="its">Causal lift</option>
          </select>
        </label>
      </header>
      <div className="impact-tiles">
        <article>
          <h2>Estimated lift</h2>
          <p>{view.measuredLabel}</p>
        </article>
        <article>
          <h2>95% interval</h2>
          <p>{primary?.ci95Label ?? "—"}</p>
        </article>
        <article>
          <h2>Readout</h2>
          <p className="readout-value">{view.predictionStatus}</p>
        </article>
        <article>
          <h2>Actions complete</h2>
          <p>
            {view.completedActions}/{view.plannedActions}
          </p>
        </article>
      </div>
      <p className="impact-readout-detail">{view.predictionDetail}</p>
      <ReportImpactTimeline
        metric={metric}
        actions={actions}
        primaryActionId={view.primaryActionId}
        levels={view.timelineLevels}
      />
      <section className="impact-results">
        <div className="section-heading">
          <h2>Action results</h2>
          <Link href="/actions">Actions →</Link>
        </div>
        <div className="overflow-auto">
          <table className="metric-library-table" aria-label="Action results">
            <thead>
              <tr>
                <th>Action</th>
                <th>Completed</th>
                <th>Individual lift</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {view.actionTraces.map((trace) => (
                <tr key={trace.actionId}>
                  <td>
                    <Link href={trace.href}>{trace.title}</Link>
                  </td>
                  <td>
                    {trace.completedOn
                      ? formatLongDate(trace.completedOn)
                      : "—"}
                  </td>
                  <td>
                    {trace.isPrimary ? "Not isolated" : trace.impactLabel}
                  </td>
                  <td>
                    <details>
                      <summary>{trace.stateLabel}</summary>
                      <p>{trace.detail}</p>
                      {trace.ci95Label && <p>{trace.ci95Label}</p>}
                      {trace.sampleLabel && <p>{trace.sampleLabel}</p>}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="impact-readout-detail">
          The registered intervention is measured as a whole. Individual action
          and AI contributions are not isolated.
        </p>
      </section>
      <details className="impact-model-details">
        <summary>Model &amp; estimate</summary>
        <p>
          Interrupted Time Series · {view.nPre ?? "—"} days before ·{" "}
          {view.nPost ?? "—"} days after
        </p>
        <PredictionPanel
          decision={decision}
          predictionId={predictionId}
          projection={projection}
          metric={metric}
        />
      </details>
    </>
  );
}

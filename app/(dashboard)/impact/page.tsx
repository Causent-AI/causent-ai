import { loadDashboardData } from "@/lib/data/dashboard";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { AggregatedImpact } from "@/components/impact/AggregatedImpact";
import { ActionsTable } from "@/components/impact/ActionsTable";
import { TrustCaveat } from "@/components/impact/TrustCaveat";
import { ImpactBar } from "@/components/charts/ImpactBar";
import { CausalRecomputeStatus } from "@/components/causal/CausalRecomputeStatus";
import { PredictionPanel } from "@/components/impact/PredictionPanel";
import { ReportImpactOverview } from "@/components/impact/ReportImpactOverview";

export default async function ImpactPage() {
  const {
    actions,
    aggregatedImpact,
    impactByMetric,
    impactMetrics,
    decisions,
    activeDecisionReport,
    causalRecomputeStatus,
  } =
    await loadDashboardData();
  const activeDecision = activeDecisionReport
    ? decisions.find((decision) => decision.id === activeDecisionReport.decisionId) ?? null
    : null;
  const activeMetric = activeDecisionReport
    ? impactMetrics.find(
        (metric) => metric.name === activeDecisionReport.metricProjection.metricName,
      ) ?? impactMetrics[0] ?? null
    : null;
  const hasReportImpactView = Boolean(
    activeDecisionReport && activeDecision && activeMetric,
  );

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 p-5">
      {activeDecisionReport && causalRecomputeStatus ? (
        <CausalRecomputeStatus status={causalRecomputeStatus} />
      ) : null}
      {activeDecisionReport && activeDecision && activeMetric ? (
        <ReportImpactOverview
          reportTitle={activeDecisionReport.title}
          decision={activeDecision}
          predictionId={activeDecisionReport.predictionId}
          projection={activeDecisionReport.metricProjection}
          metric={activeMetric}
          metrics={impactMetrics}
          actions={actions}
        />
      ) : (
        <AggregatedImpact
          stats={aggregatedImpact}
          impactByMetric={impactByMetric}
          metrics={impactMetrics}
          scopeLabel={activeDecisionReport ? "in this report" : "in this workspace"}
        />
      )}

      {activeDecisionReport && !hasReportImpactView ? (
        <PredictionPanel
          decision={activeDecision}
          predictionId={activeDecisionReport.predictionId}
          projection={activeDecisionReport.metricProjection}
          metric={activeMetric}
        />
      ) : null}

      {!hasReportImpactView ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--text)]">Impact by Metric</h2>
                <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Estimated causal lift</p>
              </div>
              <Link href="/data-workshop" className="min-h-9 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50">
                Data →
              </Link>
            </div>
            <ImpactBar rows={impactByMetric} metrics={impactMetrics} />
          </Panel>

          <Panel>
            <h2 className="mb-4 text-[15px] font-semibold text-[var(--text)]">Impact by Actions</h2>
            <ActionsTable actions={actions} metrics={impactMetrics} />
          </Panel>
        </div>
      ) : null}

      <TrustCaveat />
    </div>
  );
}

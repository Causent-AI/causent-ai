import { Suspense } from "react";
import { loadDashboardData } from "@/lib/data/dashboard";
import { ActionsPageClient } from "@/components/actions/ActionsPageClient";
import { buildDecisionLoopActionHandoffs } from "@/lib/decision-reports/loop-handoff";

// Server page: reads decisions + actions + metrics from lib/data (Supabase,
// seed fallback) and hands them to the client child, which owns the
// click-to-select interactivity. Suspense boundary: the client child reads
// ?selected via useSearchParams, which requires one for static prerender.
//
// force-dynamic: this tab WRITES (capture, revisions, resolve-now), so it must
// re-read per request rather than serve a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const {
    actions,
    decisions,
    metrics,
    impactMetrics,
    objective,
    activeDecisionReport,
  } = await loadDashboardData();
  const decisionLoopHandoffs = buildDecisionLoopActionHandoffs({
    currentReport: activeDecisionReport
      ? {
          reportId: activeDecisionReport.id,
          revisionId: activeDecisionReport.revisionId,
          activeActivationId: activeDecisionReport.activeActivationId,
          status: activeDecisionReport.status,
          isCurrent: activeDecisionReport.isCurrent,
          iterationNumber: activeDecisionReport.iterationNumber,
          decisionId: activeDecisionReport.decisionId,
          predictionId: activeDecisionReport.predictionId,
          report: activeDecisionReport.report,
          metricProjection: activeDecisionReport.metricProjection,
        }
      : null,
    decisions,
    actions,
    actionMetrics: metrics.map((metric) => ({ id: metric.id, name: metric.name })),
  });
  return (
    <Suspense>
      <ActionsPageClient
        actions={actions}
        decisions={decisions}
        metrics={metrics}
        objective={objective}
        connectorMetricId={activeDecisionReport ? impactMetrics[0]?.id ?? null : null}
        decisionReport={activeDecisionReport?.report ?? null}
        decisionReportId={activeDecisionReport?.id ?? null}
        decisionLoopHandoffs={decisionLoopHandoffs}
      />
    </Suspense>
  );
}

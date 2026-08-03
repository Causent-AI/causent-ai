import { Suspense } from "react";
import { loadDashboardData } from "@/lib/data/dashboard";
import { ActionsPageClient } from "@/components/actions/ActionsPageClient";
import { buildDecisionLoopHandoff } from "@/lib/decision-reports/loop-handoff";

// Server page: reads decisions + actions + metrics from lib/data (Supabase,
// seed fallback) and hands them to the client child, which owns the
// click-to-select interactivity. Suspense boundary: the client child reads
// ?selected via useSearchParams, which requires one for static prerender.
//
// force-dynamic: this tab WRITES (capture, revisions, resolve-now), so it must
// re-read per request rather than serve a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const { actions, decisions, metrics, objective, activeDecisionReport } = await loadDashboardData();
  const activeDecision = activeDecisionReport?.decisionId
    ? decisions.find((decision) => decision.id === activeDecisionReport.decisionId)
    : undefined;
  const activePrediction = activeDecisionReport?.predictionId
    ? activeDecision?.predictions.find(
        (prediction) => prediction.id === activeDecisionReport.predictionId,
      )
    : undefined;
  const decisionLoopHandoffs =
    activeDecisionReport && activeDecision && activePrediction
      ? actions.flatMap((action) => {
          if (!activeDecision.actionIds.includes(action.id)) return [];
          const result = buildDecisionLoopHandoff({
            currentReport: {
              reportId: activeDecisionReport.id,
              revisionId: activeDecisionReport.revisionId,
              status: activeDecisionReport.status,
              isCurrent: activeDecisionReport.isCurrent,
              iterationNumber: activeDecisionReport.iterationNumber,
              decisionId: activeDecisionReport.decisionId,
              predictionId: activeDecisionReport.predictionId,
              report: activeDecisionReport.report,
              metricProjection: activeDecisionReport.metricProjection,
            },
            selection: {
              reportId: activeDecisionReport.id,
              revisionId: activeDecisionReport.revisionId,
              iterationNumber: activeDecisionReport.iterationNumber,
              decision: activeDecision,
              prediction: activePrediction,
              action,
            },
          });
          return result.ok ? [{ actionId: action.id, handoff: result.handoff }] : [];
        })
      : [];
  return (
    <Suspense>
      <ActionsPageClient
        actions={actions}
        decisions={decisions}
        metrics={metrics}
        objective={objective}
        connectorMetricId={activeDecisionReport?.metricId ?? null}
        decisionReport={activeDecisionReport?.report ?? null}
        decisionLoopHandoffs={decisionLoopHandoffs}
      />
    </Suspense>
  );
}

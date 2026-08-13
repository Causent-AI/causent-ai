import Link from "next/link";
import { loadDashboardData } from "@/lib/data/dashboard";
import { Panel } from "@/components/ui/Panel";
import { ConnectedMetrics } from "@/components/data-workshop/ConnectedMetrics";
import { WorkspaceMetricCatalog } from "@/components/data-workshop/WorkspaceMetricCatalog";
import { WorkspaceMetricCsvDropzone } from "@/components/data-workshop/WorkspaceMetricCsvDropzone";
import { summarizeMetricConnections } from "@/lib/data/metric-connections";
import { getSession } from "@/lib/auth/session";
import { loadReportActivationMetrics } from "@/lib/decision-reports/materialization";
import { getServerSupabase } from "@/lib/supabase-server";
import { CausalRecomputeStatus } from "@/components/causal/CausalRecomputeStatus";

// The workspace catalog is session-scoped and must never be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function DataWorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedReturn = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = requestedReturn && /^\/onboarding\?report=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedReturn)
    ? requestedReturn
    : null;
  const [{ metrics, activeDecisionReport, causalRecomputeStatus }, session, sb] = await Promise.all([
    loadDashboardData(),
    getSession(),
    getServerSupabase(),
  ]);
  const workspaceMetrics = await loadReportActivationMetrics(sb, session.workspaceId);
  const activeMetric = workspaceMetrics.find(
    (metric) => metric.metricId === activeDecisionReport?.metricId,
  ) ?? null;
  const removableMetricIdByName = Object.fromEntries(
    workspaceMetrics.filter((metric) => metric.isCore).map((metric) => [metric.name, metric.metricId]),
  );
  const lockedMetricName = workspaceMetrics.find(
    (metric) => metric.metricId === activeDecisionReport?.metricId && !metric.isCore,
  )?.name ?? null;
  const metricConnections = activeDecisionReport
    ? {
        connected: metrics.filter((metric) => metric.series.length > 0).length,
        total: metrics.length,
      }
    : summarizeMetricConnections(metrics.length);

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 p-4 sm:p-5">
      {returnTo ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3">
          <div>
            <p className="text-[12px] font-semibold text-teal-950">Decision Report metric handoff</p>
            <p className="mt-0.5 text-[11px] leading-5 text-teal-900/75">
              Review the workspace metrics here, then return to confirm one against the report.
            </p>
          </div>
          <Link href={returnTo} className="rounded-lg bg-teal-900 px-3 py-2 text-[11px] font-semibold text-white">
            Return to Decision Report
          </Link>
        </div>
      ) : null}
      {activeDecisionReport && causalRecomputeStatus ? (
        <CausalRecomputeStatus status={causalRecomputeStatus} />
      ) : null}
      <div className="space-y-4">
          <Panel>
            <WorkspaceMetricCsvDropzone
              activeMetricName={activeMetric?.name ?? activeDecisionReport?.metricProjection.metricName ?? null}
              activeMetricUnit={activeMetric?.unit ?? null}
            />
          </Panel>
          <Panel>
            {activeDecisionReport ? (
              <>
                <ConnectedMetrics metrics={metrics} connectionSummary={metricConnections} removableMetricIdByName={removableMetricIdByName} lockedMetricName={lockedMetricName} />
                <div className="mt-5 border-t border-[var(--border)] pt-5">
                  <WorkspaceMetricCatalog
                    metrics={workspaceMetrics}
                    activeMetricId={activeDecisionReport.metricId}
                  />
                </div>
              </>
            ) : (
              <>
                <ConnectedMetrics metrics={metrics} connectionSummary={metricConnections} removableMetricIdByName={removableMetricIdByName} lockedMetricName={lockedMetricName} />
                <div className="mt-5 border-t border-[var(--border)] pt-5">
                  <WorkspaceMetricCatalog
                    metrics={workspaceMetrics}
                  />
                </div>
              </>
            )}
          </Panel>
      </div>
    </div>
  );
}

import Link from "next/link";
import { MeasurementPlan } from "@/components/data-workshop/MeasurementPlan";
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
import { Ga4Connections } from "@/components/data-workshop/Ga4Connections";

// The workspace catalog is session-scoped and must never be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function DataWorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; ga4?: string }>;
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
  const ga4Enabled = process.env.CAUSENT_GA4_ENABLED === "1" && process.env.CAUSENT_LOCAL_DEMO !== "1" && process.env.CAUSENT_USE_SEED !== "1";
  const [ga4Connections, ga4Access, ga4Health] = ga4Enabled ? await Promise.all([
    sb.from("ga4_connections").select("connection_id,property_name,property_id,timezone,status,last_sync_at,error_code").eq("scope_id", session.workspaceId).order("created_at").limit(21),
    sb.rpc("has_scope_access", { target_scope: session.workspaceId, min_role: "admin" }),
    sb.from("ga4_metric_health").select("connection_id,metric_id,provider_metric,row_count,missing_days,start_date,end_date,reason").eq("scope_id", session.workspaceId).limit(61),
  ]) : [null, null, null];
  if (ga4Connections?.error || ga4Access?.error || ga4Health?.error || (ga4Connections?.data?.length ?? 0) > 20 || (ga4Health?.data?.length ?? 0) > 60) throw new Error("Google Analytics connections unavailable");
  const activationId = activeDecisionReport?.activeActivationId;
  const planResponse = activationId ? await sb.from("measurement_plans")
    .select("plan_id,exposure_start,window_start,window_end,lag_days,population,decision_threshold,concurrent_change_status")
    .eq("activation_id", activationId).eq("scope_id", session.workspaceId).maybeSingle() : null;
  if (planResponse?.error) throw new Error("Measurement plan unavailable");
  const registered = planResponse?.data;
  const exposureResponse = registered ? await sb.from("measurement_exposures")
    .select("action_id,first_exposure,fully_exposed").eq("plan_id", registered.plan_id)
    .eq("scope_id", session.workspaceId) : null;
  if (exposureResponse?.error) throw new Error("Exposure records unavailable");
  const exposureByAction = new Map((exposureResponse?.data ?? []).map((row) => [row.action_id, row]));
  const included = activationId ? await sb.from("decision_report_activations").select("action_ids")
    .eq("activation_id", activationId).eq("scope_id", session.workspaceId).single() : null;
  if (included?.error) throw new Error("Included actions unavailable");
  const actionResponse = included?.data ? await sb.from("actions").select("action_id,rationale_richtext,external_ref,source")
    .eq("scope_id", session.workspaceId).in("action_id", included.data.action_ids) : null;
  if (actionResponse?.error) throw new Error("Included action labels unavailable");
  const measurementActions = (actionResponse?.data ?? []).map((row) => {
    const exposure = exposureByAction.get(row.action_id);
    return { id: row.action_id, label: row.rationale_richtext?.title || row.external_ref || row.source,
      exposure: exposure ? { first: exposure.first_exposure, full: exposure.fully_exposed } : null };
  });
  const activeMetric = workspaceMetrics.find(
    (metric) => metric.metricId === activeDecisionReport?.metricId,
  ) ?? null;
  const removableMetricIdByName = Object.fromEntries(
    workspaceMetrics.filter((metric) => metric.isCore).map((metric) => [metric.name, metric.metricId]),
  );
  const lockedMetricName = workspaceMetrics.find(
    (metric) => metric.metricId === activeDecisionReport?.metricId && !metric.isCore,
  )?.name ?? null;
  const metricConnections = summarizeMetricConnections(metrics);

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 p-4 sm:p-5">
      {returnTo ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3">
          <p className="text-[12px] font-semibold text-teal-950">Choose report metrics</p>
          <Link href={returnTo} className="rounded-lg bg-teal-900 px-3 py-2 text-[11px] font-semibold text-white">
            Return to Decision Report
          </Link>
        </div>
      ) : null}
      {activeDecisionReport && causalRecomputeStatus ? (
        <CausalRecomputeStatus status={causalRecomputeStatus} />
      ) : null}
      {activationId ? <Panel><MeasurementPlan activationId={activationId} actions={measurementActions} plan={registered ? {
        planId: registered.plan_id, exposureStart: registered.exposure_start, windowStart: registered.window_start,
        windowEnd: registered.window_end, lagDays: registered.lag_days, population: registered.population,
        threshold: Number(registered.decision_threshold), concurrentStatus: registered.concurrent_change_status,
      } : null} /></Panel> : null}
      <div className="space-y-4">
          <Panel>
            <Ga4Connections connections={ga4Connections?.data ?? []} health={ga4Health?.data ?? []} enabled={ga4Enabled} admin={ga4Access?.data === true} notice={params.ga4} />
          </Panel>
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

import Link from "next/link";
import { WorkshopTabs } from "@/components/data-workshop/WorkshopTabs";
import { AiWorkspace } from "@/components/data-workshop/AiWorkspace";
import { GENERATION_MODEL } from "@/lib/decision-reports/generation-admission";
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
  searchParams: Promise<{ returnTo?: string | string[]; ga4?: string; tab?: string; add?: string }>;
}) {
  const params = await searchParams;
  const requestedReturn = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = requestedReturn && /^\/onboarding\?report=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedReturn)
    ? requestedReturn
    : null;
  const [{ metrics, activeDecisionReport, decisionReports, causalRecomputeStatus }, session, sb] = await Promise.all([
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
    <WorkshopTabs key={`${params.tab ?? (params.ga4 ? "connections" : "metrics")}-${params.add ?? ""}-${returnTo ?? ""}`} initialTab={params.ga4 || params.tab === "connections" ? "connections" : params.tab === "ai" ? "ai" : "metrics"} connections={<div className="connection-grid">
      <article className="connection-card"><Ga4Connections connections={ga4Connections?.data ?? []} health={ga4Health?.data ?? []} enabled={ga4Enabled} admin={ga4Access?.data === true} notice={params.ga4}/></article>
      <article className="connection-card"><h2>GitHub</h2><p>Pull requests and action completion.</p><span className="status-label">Managed by workspace operator</span></article>
      <article className="connection-card"><h2>BigQuery</h2><p>Warehouse metrics and daily observations.</p><span className="status-label">Setup required</span></article>
      <article className="connection-card"><h2>CSV</h2><p>Upload existing metric history.</p><Link className="button mt-4" href="/data-workshop?add=metric">Import</Link></article>
    </div>} ai={<AiWorkspace model={process.env.CAUSENT_DECISION_REPORT_MODEL?.trim() || GENERATION_MODEL} estimates={decisionReports.filter((r) => r.isCurrent || r.status !== "active").flatMap((r) => r.report.implementation.actions.map((a) => ({ reportId: r.id, report: r.title, action: a.title, cost: a.estimatedCost ?? "", time: a.estimatedTime ?? "" })))}/>} metrics={<div className="space-y-6">
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
      {activationId ? <details><summary className="button">Measurement plan</summary><Panel><MeasurementPlan activationId={activationId} actions={measurementActions} plan={registered ? {
        planId: registered.plan_id, exposureStart: registered.exposure_start, windowStart: registered.window_start,
        windowEnd: registered.window_end, lagDays: registered.lag_days, population: registered.population,
        threshold: Number(registered.decision_threshold), concurrentStatus: registered.concurrent_change_status,
      } : null} /></Panel></details> : null}
      <div className="space-y-4">
          <details open={params.add === "metric" || Boolean(returnTo)} className="metric-import"><summary className="button">＋ Add metric</summary><Panel>
            <WorkspaceMetricCsvDropzone
              activeMetricName={activeMetric?.name ?? activeDecisionReport?.metricProjection.metricName ?? null}
              activeMetricUnit={activeMetric?.unit ?? null}
            />
          </Panel></details>
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
    </div>}/>
  );
}

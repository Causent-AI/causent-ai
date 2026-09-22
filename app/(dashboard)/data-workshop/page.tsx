import Link from "next/link";
import { WorkshopTabs } from "@/components/data-workshop/WorkshopTabs";
import { AiWorkspace } from "@/components/data-workshop/AiWorkspace";
import { GENERATION_MODEL } from "@/lib/decision-reports/generation-admission";
import { MeasurementPlan } from "@/components/data-workshop/MeasurementPlan";
import { loadDashboardData } from "@/lib/data/dashboard";
import { Panel } from "@/components/ui/Panel";
import { MetricLibrary } from "@/components/data-workshop/MetricLibrary";
import { getMetricRecords } from "@/lib/data/metrics";
import { WorkspaceMetricCsvDropzone } from "@/components/data-workshop/WorkspaceMetricCsvDropzone";
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
  searchParams: Promise<{
    returnTo?: string | string[];
    ga4?: string;
    tab?: string;
    add?: string;
  }>;
}) {
  const params = await searchParams;
  const requestedReturn = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const returnTo =
    requestedReturn &&
    /^\/onboarding\?report=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestedReturn,
    )
      ? requestedReturn
      : null;
  const [
    { activeDecisionReport, decisionReports, causalRecomputeStatus },
    session,
    sb,
  ] = await Promise.all([
    loadDashboardData(),
    getSession(),
    getServerSupabase(),
  ]);
  const [workspaceMetrics, metricRecords] = await Promise.all([
    loadReportActivationMetrics(sb, session.workspaceId),
    getMetricRecords(session.workspaceId),
  ]);
  const ga4Enabled =
    process.env.CAUSENT_GA4_ENABLED === "1" &&
    process.env.CAUSENT_LOCAL_DEMO !== "1" &&
    process.env.CAUSENT_USE_SEED !== "1";
  const [ga4Connections, ga4Access, ga4Health] = ga4Enabled
    ? await Promise.all([
        sb
          .from("ga4_connections")
          .select(
            "connection_id,property_name,property_id,timezone,status,last_sync_at,error_code",
          )
          .eq("scope_id", session.workspaceId)
          .order("created_at")
          .limit(21),
        sb.rpc("has_scope_access", {
          target_scope: session.workspaceId,
          min_role: "admin",
        }),
        sb
          .from("ga4_metric_health")
          .select(
            "connection_id,metric_id,provider_metric,row_count,missing_days,start_date,end_date,reason",
          )
          .eq("scope_id", session.workspaceId)
          .limit(61),
      ])
    : [null, null, null];
  if (
    ga4Connections?.error ||
    ga4Access?.error ||
    ga4Health?.error ||
    (ga4Connections?.data?.length ?? 0) > 20 ||
    (ga4Health?.data?.length ?? 0) > 60
  )
    throw new Error("Google Analytics connections unavailable");
  const activationId = activeDecisionReport?.activeActivationId;
  const planResponse = activationId
    ? await sb
        .from("measurement_plans")
        .select(
          "plan_id,exposure_start,window_start,window_end,lag_days,population,decision_threshold,concurrent_change_status",
        )
        .eq("activation_id", activationId)
        .eq("scope_id", session.workspaceId)
        .maybeSingle()
    : null;
  if (planResponse?.error) throw new Error("Measurement plan unavailable");
  const registered = planResponse?.data;
  const exposureResponse = registered
    ? await sb
        .from("measurement_exposures")
        .select("action_id,first_exposure,fully_exposed")
        .eq("plan_id", registered.plan_id)
        .eq("scope_id", session.workspaceId)
    : null;
  if (exposureResponse?.error) throw new Error("Exposure records unavailable");
  const exposureByAction = new Map(
    (exposureResponse?.data ?? []).map((row) => [row.action_id, row]),
  );
  const included = activationId
    ? await sb
        .from("decision_report_activations")
        .select("action_ids")
        .eq("activation_id", activationId)
        .eq("scope_id", session.workspaceId)
        .single()
    : null;
  if (included?.error) throw new Error("Included actions unavailable");
  const actionResponse = included?.data
    ? await sb
        .from("actions")
        .select("action_id,rationale_richtext,external_ref,source")
        .eq("scope_id", session.workspaceId)
        .in("action_id", included.data.action_ids)
    : null;
  if (actionResponse?.error)
    throw new Error("Included action labels unavailable");
  const measurementActions = (actionResponse?.data ?? []).map((row) => {
    const exposure = exposureByAction.get(row.action_id);
    return {
      id: row.action_id,
      label: row.rationale_richtext?.title || row.external_ref || row.source,
      exposure: exposure
        ? { first: exposure.first_exposure, full: exposure.fully_exposed }
        : null,
    };
  });
  const activeMetric =
    workspaceMetrics.find(
      (metric) => metric.metricId === activeDecisionReport?.metricId,
    ) ?? null;

  return (
    <WorkshopTabs
      key={`${params.tab ?? (params.ga4 ? "connections" : "metrics")}-${params.add ?? ""}-${returnTo ?? ""}`}
      initialTab={
        params.ga4 || params.tab === "connections"
          ? "connections"
          : params.tab === "ai"
            ? "ai"
            : "metrics"
      }
      connections={
        <section>
          <div className="section-heading">
            <h2>Connections</h2>
          </div>
          <div className="connection-grid">
            <article className="connection-card">
              <div className="connection-card-top">
                <span className="connection-glyph">GH</span>
                <span className="connection-state">Operator managed</span>
              </div>
              <h3>GitHub</h3>
              <p>Code &amp; PRs</p>
              <code>Workspace integration</code>
              <footer>
                <span>GitHub</span>
                <Link href="/actions">View actions ↗</Link>
              </footer>
            </article>
            <article className="connection-card">
              <div className="connection-card-top">
                <span className="connection-glyph">BQ</span>
                <span className="connection-state">Not connected</span>
              </div>
              <h3>BigQuery</h3>
              <p>Data warehouse</p>
              <code>Not configured</code>
              <footer>
                <span>Google</span>
                <span>Setup required</span>
              </footer>
            </article>
            <article className="connection-card">
              <div className="connection-card-top">
                <span className="connection-glyph">GA</span>
                <span className="connection-state">
                  {ga4Enabled && ga4Connections?.data?.length
                    ? "Configured"
                    : "Not connected"}
                </span>
              </div>
              <h3>Google Analytics</h3>
              <p>Web analytics</p>
              <code>{ga4Enabled ? "GA4" : "Not configured"}</code>
              <footer>
                <span>Google</span>
                <span>{ga4Enabled ? "Manage below" : "Setup required"}</span>
              </footer>
            </article>
          </div>
          {ga4Enabled && (
            <div className="mt-8">
              <Ga4Connections
                connections={ga4Connections?.data ?? []}
                health={ga4Health?.data ?? []}
                enabled={ga4Enabled}
                admin={ga4Access?.data === true}
                notice={params.ga4}
              />
            </div>
          )}
        </section>
      }
      ai={
        <AiWorkspace
          model={
            process.env.CAUSENT_DECISION_REPORT_MODEL?.trim() ||
            GENERATION_MODEL
          }
          estimates={decisionReports
            .filter((r) => r.isCurrent || r.status !== "active")
            .flatMap((r) =>
              r.report.implementation.actions.map((a) => ({
                reportId: r.id,
                report: r.title,
                action: a.title,
                cost: a.estimatedCost ?? "",
                time: a.estimatedTime ?? "",
              })),
            )}
        />
      }
      metrics={
        <div className="space-y-6">
          {returnTo ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3">
              <p className="text-[12px] font-semibold text-teal-950">
                Choose report metrics
              </p>
              <Link
                href={returnTo}
                className="rounded-lg bg-teal-900 px-3 py-2 text-[11px] font-semibold text-white"
              >
                Return to Decision Report
              </Link>
            </div>
          ) : null}
          {activeDecisionReport &&
          causalRecomputeStatus &&
          causalRecomputeStatus.state !== "current" ? (
            <CausalRecomputeStatus status={causalRecomputeStatus} />
          ) : null}
          <MetricLibrary
            records={metricRecords.map(({ metricId, metric, isCore }) => ({
              metricId,
              metric,
              isCore,
            }))}
            initiallyOpen={params.add === "metric"}
            importer={
              <WorkspaceMetricCsvDropzone
                activeMetricName={
                  activeMetric?.name ??
                  activeDecisionReport?.metricProjection.metricName ??
                  null
                }
                activeMetricUnit={activeMetric?.unit ?? null}
              />
            }
          />
          {activationId ? (
            <details>
              <summary className="quiet-summary">Measurement plan</summary>
              {causalRecomputeStatus?.state === "current" && (
                <CausalRecomputeStatus status={causalRecomputeStatus} />
              )}
              <Panel>
                <MeasurementPlan
                  activationId={activationId}
                  actions={measurementActions}
                  plan={
                    registered
                      ? {
                          planId: registered.plan_id,
                          exposureStart: registered.exposure_start,
                          windowStart: registered.window_start,
                          windowEnd: registered.window_end,
                          lagDays: registered.lag_days,
                          population: registered.population,
                          threshold: Number(registered.decision_threshold),
                          concurrentStatus: registered.concurrent_change_status,
                        }
                      : null
                  }
                />
              </Panel>
            </details>
          ) : null}
        </div>
      }
    />
  );
}

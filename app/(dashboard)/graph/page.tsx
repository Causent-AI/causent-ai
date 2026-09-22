import { getSession } from "@/lib/auth/session";
import { listAccessibleWorkspaces } from "@/lib/auth/workspace-context";
import { getServerSupabase } from "@/lib/supabase-server";
import { loadDashboardDataForWorkspace } from "@/lib/data/dashboard";
import { getDecisions } from "@/lib/data/decisions";
import { getActions } from "@/lib/data/actions";
import { getMetricRecords } from "@/lib/data/metrics";
import { buildDecisionNetwork } from "@/lib/data/decision-network";
import { DecisionNetwork } from "@/components/graph/DecisionNetwork";
import { staticDemoWorkspaceOption } from "@/lib/auth/workspace-selection";
export const dynamic = "force-dynamic";
export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const workspaces =
    process.env.CAUSENT_USE_SEED === "1"
      ? [staticDemoWorkspaceOption()]
      : await listAccessibleWorkspaces(await getServerSupabase());
  const all = params.scope === "all" && workspaces.length <= 20;
  const requested =
    workspaces.find((workspace) => workspace.id === params.scope)?.id ??
    session.workspaceId;
  const included = all
    ? workspaces
    : workspaces.filter((workspace) => workspace.id === requested);
  const data = [];
  for (const workspace of included) {
    const [dashboard, records, decisions, actions] = await Promise.all([
      loadDashboardDataForWorkspace(workspace.id, session.userId),
      getMetricRecords(workspace.id),
      getDecisions(workspace.id, session.userId),
      getActions(workspace.id),
    ]);
    data.push({
      workspace,
      dashboard,
      decisions,
      actions,
      metricIds: Object.fromEntries(
        records.map((record) => [record.metricId, record.metric.id]),
      ),
    });
  }
  return (
    <DecisionNetwork
      key={params.scope ?? session.workspaceId}
      scope={all ? "all" : requested}
      activeWorkspaceId={session.workspaceId}
      workspaces={workspaces}
      nodes={data.flatMap(
        ({ workspace, dashboard, decisions, actions, metricIds }) =>
          buildDecisionNetwork({
            workspaceId: workspace.id,
            project: workspace.project,
            workspace: workspace.workspace,
            reports: dashboard.decisionReports,
            decisions,
            actions,
            metrics: dashboard.metrics,
            metricIds,
          }),
      )}
      metrics={data.flatMap(({ workspace, dashboard }) =>
        dashboard.metrics.map((metric) => ({
          id: `${workspace.id}:${metric.id}`,
          name: metric.name,
          workspace: workspace.workspace,
        })),
      )}
    />
  );
}

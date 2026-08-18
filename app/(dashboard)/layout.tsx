import { Suspense } from "react";
import { GlobalHeader } from "@/components/shell/GlobalHeader";
import { TabStrip } from "@/components/shell/TabStrip";
import { CoreMetricsDrawer } from "@/components/shell/CoreMetricsDrawer";
import { loadDashboardDataForWorkspace } from "@/lib/data/dashboard";
import { getSession } from "@/lib/auth/session";
import { listAccessibleDemoWorkspaces } from "@/lib/auth/workspace-context";
import { staticDemoWorkspaceOption } from "@/lib/auth/workspace-selection";
import { getServerSupabase } from "@/lib/supabase-server";

// Every dashboard route is workspace- and current-report-specific. Keep the
// shared shell request-bound as well so a production build can never freeze a
// seed or pre-activation snapshot into Reports, Impact, or the metrics drawer.
export const dynamic = "force-dynamic";

// Persistent shell: global header + tab strip on top, the active tab in the
// scrolling middle, and the Core Metrics drawer pinned to the bottom on every tab.
// Data (scope + metrics + actions) is read once here (Supabase, memoized per request)
// and threaded into the shell's client components as props. Explicit static-seed
// mode remains Gummy-only and never offers an unavailable workspace switch.

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const [
    { scope, metrics, actions, decisions, activeDecisionReport },
    workspaces,
  ] = await Promise.all([
    loadDashboardDataForWorkspace(session.workspaceId, session.userId),
    process.env.CAUSENT_USE_SEED === "1"
      ? Promise.resolve([staticDemoWorkspaceOption()])
      : getServerSupabase().then(listAccessibleDemoWorkspaces),
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]">
      <GlobalHeader
        activeWorkspaceId={session.workspaceId}
        workspaces={workspaces}
      />
      <TabStrip scope={scope} />
      <main className="scroll-slim min-h-0 flex-1 overflow-y-auto">{children}</main>
      <Suspense fallback={null}>
        <CoreMetricsDrawer
          metrics={metrics}
          actions={actions}
          decisions={decisions}
          projectMetricLabel={activeDecisionReport?.metricProjection.metricName ?? null}
        />
      </Suspense>
    </div>
  );
}

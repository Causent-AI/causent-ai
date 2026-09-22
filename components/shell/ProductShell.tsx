import { Suspense, type ReactNode } from "react";
import { Ask } from "./Ask";
import { GlobalHeader } from "./GlobalHeader";
import { WorkspaceMetricsProvider } from "./WorkspaceMetrics";
import { WorkspaceTitleProvider } from "./WorkspaceTitle";
import { CoreMetricsDrawer } from "./CoreMetricsDrawer";
import { loadDashboardDataForWorkspace } from "@/lib/data/dashboard";
import { getSession } from "@/lib/auth/session";
import { listAccessibleWorkspaces } from "@/lib/auth/workspace-context";
import { staticDemoWorkspaceOption } from "@/lib/auth/workspace-selection";
import { getServerSupabase } from "@/lib/supabase-server";

export async function ProductShell({ children }: { children: ReactNode }) {
  const session = await getSession();
  const [data, workspaces] = await Promise.all([
    loadDashboardDataForWorkspace(session.workspaceId, session.userId),
    process.env.CAUSENT_USE_SEED === "1"
      ? Promise.resolve([staticDemoWorkspaceOption()])
      : getServerSupabase().then(listAccessibleWorkspaces),
  ]);
  const user = session.userId
    ? (await (await getServerSupabase()).auth.getUser()).data.user
    : null;
  const account = user
    ? {
        name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : (user.email?.split("@")[0] ?? "Account"),
        detail: user.email ?? "Signed in",
      }
    : { name: session.userId ? "Account" : "Demo", detail: session.userId ? "Signed in" : "Demo workspace" };
  return (
    <WorkspaceTitleProvider
      key={session.workspaceId}
      title={data.activeDecisionReport?.title || data.scope.workspace}
    >
      <WorkspaceMetricsProvider metrics={data.metrics}>
        <div className="causent-shell">
          <GlobalHeader
            activeWorkspaceId={session.workspaceId}
            workspaces={workspaces}
            account={account}
          />
          <Ask />
          <main
            id="workspace-content"
            className="scroll-slim workspace-content"
          >
            {children}
          </main>
          <Suspense fallback={null}>
            <CoreMetricsDrawer
              metrics={data.metrics}
              actions={data.actions}
              decisions={data.decisions}
              projectMetricLabel={
                data.activeDecisionReport?.metricProjection.metricName ?? null
              }
            />
          </Suspense>
        </div>
      </WorkspaceMetricsProvider>
    </WorkspaceTitleProvider>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { OnboardingFunnel } from "@/components/onboarding/OnboardingFunnel";
import {
  DecisionReportOnboarding,
  type InitialSavedDecisionReport,
} from "@/components/decision-report/DecisionReportOnboarding";
import { getSession } from "@/lib/auth/session";
import { getScope } from "@/lib/data/scope";
import { loadDecisionReport, UUID_PATTERN } from "@/lib/decision-reports/persistence";
import {
  loadReportActivationMetrics,
  type ReportActivationMetric,
} from "@/lib/decision-reports/materialization";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";
import { loadAttachedReportAsset } from "@/lib/decision-reports/assets";
import {
  loadDecisionReportRolloutState,
  resolveOnboardingFlow,
} from "@/lib/decision-reports/rollout";

// Slice 5 of the AI-assisted onboarding: a reviewed saved revision can be
// explicitly activated into one decision, one human prediction, and selected
// planned actions through a checked idempotent RPC.

export const metadata: Metadata = {
  title: "Causent — Build a Decision Report",
};

// The funnel writes on every visit path; never prerender it at build time.
export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{
    report?: string | string[];
    flow?: string | string[];
  }>;
}) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const activationDateBounds = {
    today: today.toISOString().slice(0, 10),
    minimum: tomorrow.toISOString().slice(0, 10),
  };
  const initialTelemetrySessionKey = `dr-${randomUUID()}`;
  const params = await searchParams;
  const requestedReportId = Array.isArray(params.report) ? params.report[0] : params.report;
  const requestedFlow = Array.isArray(params.flow) ? params.flow[0] : params.flow;
  let initialSavedReport: InitialSavedDecisionReport | null = null;
  let initialLoadError: string | null = null;
  let activationMetrics: ReportActivationMetric[] = [];
  const session = await getSession();
  const sb = await getServerSupabase();
  const [rolloutState, activeScope] = await Promise.all([
    loadDecisionReportRolloutState(
      sb,
      session.workspaceId,
      session.userId,
      isLocalDemo() && process.env.CAUSENT_DECISION_REPORT_LOCAL_ROLLOUT === "1",
    ),
    getScope(session.workspaceId),
  ]);
  const flow = resolveOnboardingFlow({
    requestedFlow: requestedFlow ?? null,
    hasSavedReport: Boolean(requestedReportId),
    rolloutState,
  });

  if (!requestedReportId && requestedFlow !== flow) {
    redirect(`/onboarding?flow=${flow}`);
  }

  if (flow === "legacy") {
    return <OnboardingFunnel />;
  }

  if (isLocalDemo() || session.userId) {
    activationMetrics = await loadReportActivationMetrics(
      sb,
      session.workspaceId,
    );
  }

  if (requestedReportId) {
    if (!UUID_PATTERN.test(requestedReportId)) {
      initialLoadError = "That saved-report address is invalid.";
    } else {
      if (!isLocalDemo() && !session.userId) {
        initialLoadError = "Sign in to open this saved report.";
      } else {
        try {
          const [loaded, asset] = await Promise.all([
            loadDecisionReport(
              sb,
              session.workspaceId,
              requestedReportId,
            ),
            loadAttachedReportAsset(sb, session.workspaceId, requestedReportId),
          ]);

          if (loaded.ok) {
            initialSavedReport = {
              workspaceId: session.workspaceId,
              report: loaded.saved.report,
              metricProjection: loaded.saved.metricProjection,
              workspaceName: activeScope.project,
              projectName: activeScope.workspace,
              sourceSummaries: loaded.saved.report.sourceSummaries,
              persistence: {
                reportId: loaded.saved.reportId,
                revisionId: loaded.saved.revisionId,
                status: loaded.saved.status,
                savedAt: loaded.saved.savedAt,
                activation: loaded.saved.activation,
                lineage: loaded.saved.lineage
                  ? {
                      iterationNumber: loaded.saved.lineage.iterationNumber,
                      iterationReason: loaded.saved.lineage.iterationReason,
                    }
                  : null,
              },
              asset: asset ?? null,
            };
          } else {
            if (loaded.code === "database") {
              console.error("[decision-report onboarding] direct report load failed", {
                reportId: requestedReportId,
                workspaceId: session.workspaceId,
                loadCode: loaded.code,
                diagnostic: loaded.error,
              });
            }
            initialLoadError =
              "That report could not be opened. Return to Reports to confirm it is available in this workspace, then try again.";
          }
        } catch (error) {
          console.error("[decision-report onboarding] direct report load failed", {
            reportId: requestedReportId,
            workspaceId: session.workspaceId,
            error,
          });
          initialLoadError =
            "That report could not be opened. Return to Reports to confirm it is available in this workspace, then try again.";
        }
      }
    }
  }

  return (
    <DecisionReportOnboarding
      initialSavedReport={initialSavedReport}
      initialLoadError={initialLoadError}
      activationMetrics={activationMetrics}
      activationDateBounds={activationDateBounds}
      initialTelemetrySessionKey={initialTelemetrySessionKey}
      activeWorkspaceName={activeScope.workspace}
    />
  );
}

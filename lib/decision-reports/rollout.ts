import type { SupabaseClient } from "@supabase/supabase-js";

export type OnboardingFlow = "legacy" | "decision-report";
export type DecisionReportRolloutState =
  | "enabled"
  | "disabled"
  | "unassigned"
  | "unavailable";

export function resolveOnboardingFlow(input: {
  requestedFlow: string | null;
  hasSavedReport: boolean;
  rolloutState: DecisionReportRolloutState;
}): OnboardingFlow {
  if (input.hasSavedReport) return "decision-report";
  // The query string is canonical output, not an authority: a stale legacy URL
  // cannot pin a user after the current flow becomes their default.
  const targetFlow: OnboardingFlow =
    input.rolloutState === "enabled" || input.rolloutState === "unassigned"
      ? "decision-report"
      : "legacy";
  return input.requestedFlow === targetFlow ? input.requestedFlow : targetFlow;
}

function reportRolloutLookupFailure(scopeId: string, error: unknown): void {
  const errorCode = typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "unknown";
  console.error("[decision-report rollout] assignment lookup failed", {
    scopeId,
    errorCode,
  });
}

export async function loadDecisionReportRolloutState(
  sb: SupabaseClient,
  scopeId: string,
  userId: string | null,
  localDemoEnabled = false,
): Promise<DecisionReportRolloutState> {
  // Anonymous local-demo sessions remain behind their explicit environment flag.
  if (!userId) return localDemoEnabled ? "enabled" : "disabled";

  try {
    const response = await sb
      .from("decision_report_rollouts")
      .select("enabled")
      .eq("scope_id", scopeId)
      .eq("user_id", userId)
      .maybeSingle();

    if (response.error) {
      reportRolloutLookupFailure(scopeId, response.error);
      return "unavailable";
    }
    if (!response.data) return "unassigned";
    return response.data.enabled === true ? "enabled" : "disabled";
  } catch (error) {
    reportRolloutLookupFailure(scopeId, error);
    return "unavailable";
  }
}

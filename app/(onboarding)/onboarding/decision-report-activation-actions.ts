"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  materializeReportActivation,
  type MaterializeReportActivationResult,
} from "@/lib/decision-reports/materialization";
import { validateReportActivationInputV1 } from "@/lib/decision-reports/activation";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";
import { kickCausalRecompute, logDeferredCausalRecompute } from "@/lib/causal/recompute";
import { recordDecisionReportTelemetry } from "@/lib/decision-reports/telemetry";

export type ActivateDecisionReportActionResult =
  | {
      ok: true;
      activation: {
        activationId: string;
        decisionId: string;
        predictionId: string;
        actionIds: string[];
        primaryLeverActionId: string;
        activatedAt: string;
        reused: boolean;
      };
    }
  | Extract<MaterializeReportActivationResult, { ok: false }>;

export async function activateDecisionReportAction(
  input: unknown,
  telemetry?: {
    sessionKey: string;
    msSinceStart: number;
  },
): Promise<ActivateDecisionReportActionResult> {
  const validation = validateReportActivationInputV1(input);
  if (!validation.success) {
    return { ok: false, code: "validation", error: validation.errors.join("; ") };
  }

  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { ok: false, code: "forbidden", error: "Sign in before activating this report." };
  }

  const sb = await getServerSupabase();
  const emit = async (
    eventType: "REPORT_ACTIVATED" | "REPORT_ACTIVATION_FAILED",
    reused = false,
  ) => {
    if (
      !telemetry ||
      typeof telemetry.sessionKey !== "string" ||
      !Number.isSafeInteger(telemetry.msSinceStart) ||
      telemetry.msSinceStart < 0
    ) return;
    await recordDecisionReportTelemetry({
      client: sb,
      scopeId: session.workspaceId,
      userId: session.userId,
    }, {
      sessionKey: telemetry.sessionKey,
      eventType,
      msSinceStart: telemetry.msSinceStart,
      meta: { reused },
    });
  };

  const result = await materializeReportActivation(
    sb,
    validation.data,
    session.userId,
  );
  if (!result.ok) {
    await emit("REPORT_ACTIVATION_FAILED");
    return result;
  }
  await emit("REPORT_ACTIVATED", result.activation.reused);

  logDeferredCausalRecompute(await kickCausalRecompute({
    scopeId: session.workspaceId,
    metricId: validation.data.confirmedMetricId,
    limit: 1,
  }));

  revalidatePath("/onboarding");
  revalidatePath("/actions");
  revalidatePath("/impact");

  return { ok: true, activation: result.activation };
}

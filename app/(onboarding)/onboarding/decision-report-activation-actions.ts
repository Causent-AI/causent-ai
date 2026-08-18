"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  authorizeReportActivationTarget,
  materializeReportActivation,
  resolveActivatedReportAction,
  validateReportActionStartTarget,
  type MaterializedReportActivation,
  type MaterializeReportActivationResult,
} from "@/lib/decision-reports/materialization";
import { validateReportActivationInput } from "@/lib/decision-reports/activation";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";
import { kickCausalRecompute, logDeferredCausalRecompute } from "@/lib/causal/recompute";
import { recordDecisionReportTelemetry } from "@/lib/decision-reports/telemetry";

export type ActivateDecisionReportActionResult =
  | {
      ok: true;
      activation: MaterializedReportActivation;
    }
  | Extract<MaterializeReportActivationResult, { ok: false }>;

export type StartDecisionReportActionResult =
  | {
      ok: true;
      activation: MaterializedReportActivation;
      /**
       * Canonical action selected by the execution intent. A null target means
       * activation committed but the isolated binding could not be confirmed;
       * callers should fall back to the returned decision rather than retry an
       * already successful irreversible transition blindly.
       */
      selectedActionId: string | null;
    }
  | Extract<MaterializeReportActivationResult, { ok: false }>;

type ActivationTelemetry = {
  sessionKey: string;
  msSinceStart: number;
};

type ActivationIntent =
  | { kind: "activate" }
  | { kind: "start_action"; requestedActionSourceItemId: unknown };

type PerformedActivationResult =
  | {
      ok: true;
      activation: MaterializedReportActivation;
      selectedActionId: string | null;
    }
  | Extract<MaterializeReportActivationResult, { ok: false }>;

async function performDecisionReportActivation(
  input: unknown,
  telemetry: ActivationTelemetry | undefined,
  intent: ActivationIntent,
): Promise<PerformedActivationResult> {
  const validation = validateReportActivationInput(input, {
    // The database distinguishes a fresh activation from an exact receipt
    // retry; only the fresh path requires a future resolution date.
    allowExpiredResolutionDate: true,
  });
  if (!validation.success) {
    return { ok: false, code: "validation", error: validation.errors.join("; ") };
  }

  const actionTarget = intent.kind === "start_action"
    ? validateReportActionStartTarget(
      intent.requestedActionSourceItemId,
      validation.data.selectedActionSourceItemIds,
    )
    : null;
  if (actionTarget && !actionTarget.success) {
    return { ok: false, code: "validation", error: actionTarget.error };
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

  const authorization = await authorizeReportActivationTarget(sb, {
    scopeId: session.workspaceId,
    reportId: validation.data.reportId,
    revisionId: validation.data.revisionId,
  });
  if (!authorization.ok) {
    await emit("REPORT_ACTIVATION_FAILED");
    return authorization;
  }

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

  let selectedActionId: string | null = null;
  if (actionTarget?.success) {
    const resolved = await resolveActivatedReportAction(sb, {
      scopeId: session.workspaceId,
      activationId: result.activation.activationId,
      actionSourceItemId: actionTarget.actionSourceItemId,
      expectedActionIds: result.activation.actionIds,
    });
    if (resolved.ok) {
      selectedActionId = resolved.actionId;
    } else {
      console.warn("[decision-report] activated action target unavailable", {
        event: "activated_action_target_unavailable",
        reason: resolved.code,
      });
    }
  }

  logDeferredCausalRecompute(await kickCausalRecompute({
    scopeId: session.workspaceId,
    metricId: validation.data.confirmedMetricId,
    limit: 1,
  }));

  revalidatePath("/onboarding");
  revalidatePath("/actions");
  revalidatePath("/impact");

  return {
    ok: true,
    activation: result.activation,
    selectedActionId,
  };
}

export async function activateDecisionReportAction(
  input: unknown,
  telemetry?: ActivationTelemetry,
): Promise<ActivateDecisionReportActionResult> {
  const result = await performDecisionReportActivation(
    input,
    telemetry,
    { kind: "activate" },
  );
  return result.ok
    ? { ok: true, activation: result.activation }
    : result;
}

/**
 * Implicit activation boundary for a deliberate action-level execution intent.
 * The requested source item is deliberately kept outside the immutable
 * activation packet: starting a supporting action must not change the primary
 * causal pair, and retrying from another action must reuse the same receipt.
 */
export async function startDecisionReportAction(
  input: unknown,
  requestedActionSourceItemId: unknown,
  telemetry?: ActivationTelemetry,
): Promise<StartDecisionReportActionResult> {
  return performDecisionReportActivation(input, telemetry, {
    kind: "start_action",
    requestedActionSourceItemId,
  });
}

"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  materializeReportActivation,
  type MaterializeReportActivationResult,
} from "@/lib/decision-reports/materialization";
import { validateReportActivationInputV1 } from "@/lib/decision-reports/activation";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export type ActivateDecisionReportActionResult =
  | {
      ok: true;
      activation: {
        activationId: string;
        decisionId: string;
        predictionId: string;
        actionIds: string[];
        activatedAt: string;
        reused: boolean;
      };
    }
  | Extract<MaterializeReportActivationResult, { ok: false }>;

export async function activateDecisionReportAction(
  input: unknown,
): Promise<ActivateDecisionReportActionResult> {
  const validation = validateReportActivationInputV1(input);
  if (!validation.success) {
    return { ok: false, code: "validation", error: validation.errors.join("; ") };
  }

  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { ok: false, code: "forbidden", error: "Sign in before activating this report." };
  }

  const result = await materializeReportActivation(
    await getServerSupabase(),
    validation.data,
    session.userId,
  );
  if (!result.ok) return result;

  revalidatePath("/onboarding");
  revalidatePath("/actions");
  revalidatePath("/impact");

  return { ok: true, activation: result.activation };
}

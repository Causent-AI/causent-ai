"use server";

import {
  DECISION_REPORT_PROMPT_MAX_CHARS,
  DECISION_REPORT_PROMPT_MIN_CHARS,
} from "@/lib/decision-reports/generation-contract";
import {
  generateDecisionReportFromPrompt,
  type DecisionReportGenerationResult,
} from "@/lib/decision-reports/generate";
import { getSession } from "@/lib/auth/session";
import { isLocalDemo } from "@/lib/supabase-server";

export type GenerateDecisionReportActionResult =
  | { ok: true; generation: DecisionReportGenerationResult }
  | { ok: false; error: string };

export async function generateDecisionReportAction(
  rawPrompt: string,
): Promise<GenerateDecisionReportActionResult> {
  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { ok: false, error: "Sign in before generating a Decision Report." };
  }

  const prompt = rawPrompt.trim();
  if (prompt.length < DECISION_REPORT_PROMPT_MIN_CHARS) {
    return {
      ok: false,
      error: `Add at least ${DECISION_REPORT_PROMPT_MIN_CHARS} characters so Causent has enough context.`,
    };
  }
  if (prompt.length > DECISION_REPORT_PROMPT_MAX_CHARS) {
    return {
      ok: false,
      error: `Keep this first brief under ${DECISION_REPORT_PROMPT_MAX_CHARS.toLocaleString()} characters.`,
    };
  }

  try {
    return { ok: true, generation: await generateDecisionReportFromPrompt(prompt) };
  } catch {
    return {
      ok: false,
      error: "Causent could not create this draft. Your brief is unchanged; try again.",
    };
  }
}

"use server";

import {
  DECISION_REPORT_PROMPT_MAX_CHARS,
  DECISION_REPORT_PROMPT_MIN_CHARS,
} from "@/lib/decision-reports/generation-contract";
import {
  generateDecisionReportFromPrompt,
  DEFAULT_DECISION_REPORT_MODEL,
  type DecisionReportGenerationResult,
} from "@/lib/decision-reports/generate";
import {
  ReportSourceInputError,
  parseReportSourceActionInput,
  prepareReportSourceCorpus,
} from "@/lib/decision-reports/sources";
import { mintDecisionReportSourceReceipt } from "@/lib/decision-reports/source-receipts";
import { getSession } from "@/lib/auth/session";
import {
  getServerSupabase,
  getServiceRoleSupabase,
  isLocalDemo,
} from "@/lib/supabase-server";
import { recordDecisionReportTelemetry } from "@/lib/decision-reports/telemetry";
import { validateDecisionReportReviewExampleSelection } from "@/lib/decision-reports/fixtures/review-examples";
import {
  listAccessibleWorkspaces,
  writeActiveWorkspaceCookie,
} from "@/lib/auth/workspace-context";
import { getScope } from "@/lib/data/scope";
import { admitGeneration, generationRequestIdentity, generationState, hasValidGenerationReceipt, watchGeneration, GenerationAdmissionError, type GenerationLease } from "@/lib/decision-reports/generation-admission";

export type MintedDecisionReportGeneration = DecisionReportGenerationResult & {
  sourceReceiptId: string;
  sourceReceiptExpiresAt: string;
  workspaceId: string;
};

export type GenerateDecisionReportActionResult =
  | { ok: true; generation: MintedDecisionReportGeneration }
  | { ok: false; error: string; code?: string; retryAfter?: number };

function generationTelemetry(input: string | FormData): {
  sessionKey: string;
  msSinceStart: number | null;
} | null {
  if (!(input instanceof FormData)) return null;
  const sessionKey = input.get("telemetrySessionKey");
  const rawElapsed = input.get("telemetryMsSinceStart");
  if (typeof sessionKey !== "string" || typeof rawElapsed !== "string") return null;
  const msSinceStart = Number(rawElapsed);
  return {
    sessionKey,
    msSinceStart: Number.isSafeInteger(msSinceStart) ? msSinceStart : null,
  };
}

export async function generateDecisionReportAction(
  input: string | FormData,
): Promise<GenerateDecisionReportActionResult> {
  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { ok: false, error: "Sign in before generating a Decision Report." };
  }
  const requestStartedAt = Date.now();
  let targetWorkspaceId = session.workspaceId;
  const telemetry = generationTelemetry(input);
  const telemetryClient = telemetry
    ? await getServerSupabase().catch(() => null)
    : null;
  const emit = async (
    eventType:
      | "REPORT_GENERATION_STARTED"
      | "REPORT_EDITABLE"
      | "REPORT_GENERATION_FAILED",
    meta?: { usedUrl: boolean; usedPdf: boolean; usedFallback: boolean },
  ) => {
    if (!telemetry || !telemetryClient) return;
    const elapsed = telemetry.msSinceStart === null
      ? null
      : telemetry.msSinceStart + (Date.now() - requestStartedAt);
    await recordDecisionReportTelemetry({
      client: telemetryClient,
      scopeId: targetWorkspaceId,
      userId: session.userId,
    }, {
      sessionKey: telemetry.sessionKey,
      eventType,
      msSinceStart: elapsed,
      meta,
    });
  };
  let parsedInput: Awaited<ReturnType<typeof parseReportSourceActionInput>>;
  try {
    parsedInput = await parseReportSourceActionInput(input);
  } catch (error) {
    await emit("REPORT_GENERATION_FAILED");
    return {
      ok: false,
      error:
        error instanceof ReportSourceInputError
          ? error.message
          : "Causent could not read the supplied source fields.",
    };
  }
  const { brief: prompt, url: sourceUrl, pdf } = parsedInput;
  const rawReviewExampleId = input instanceof FormData
    ? input.get("reviewExampleId")
    : null;
  const reviewExampleSelection = validateDecisionReportReviewExampleSelection({
    id: rawReviewExampleId,
    prompt,
    hasAdditionalSources: Boolean(sourceUrl) || Boolean(pdf),
  });
  if (!reviewExampleSelection.ok) {
    await emit("REPORT_GENERATION_FAILED");
    return {
      ok: false,
      error:
        reviewExampleSelection.reason === "invalid_id"
          ? "Choose one of the available report examples."
          : "Reload the example after changing its brief or adding evidence.",
    };
  }
  const reviewExample = reviewExampleSelection.example;
  if (reviewExample) {
    const selectionClient = telemetryClient ?? await getServerSupabase();
    const accessible = await listAccessibleWorkspaces(selectionClient).catch(() => []);
    if (!accessible.some((workspace) => workspace.id === reviewExample.workspaceId)) {
      return { ok: false, error: "That example workspace is unavailable." };
    }
    targetWorkspaceId = reviewExample.workspaceId;
  }
  await emit("REPORT_GENERATION_STARTED");
  if (prompt.length < DECISION_REPORT_PROMPT_MIN_CHARS) {
    await emit("REPORT_GENERATION_FAILED");
    return {
      ok: false,
      error: `Add at least ${DECISION_REPORT_PROMPT_MIN_CHARS} characters so Causent has enough context.`,
    };
  }
  if (prompt.length > DECISION_REPORT_PROMPT_MAX_CHARS) {
    await emit("REPORT_GENERATION_FAILED");
    return {
      ok: false,
      error: `Keep this first brief under ${DECISION_REPORT_PROMPT_MAX_CHARS.toLocaleString()} characters.`,
    };
  }

  let lease: GenerationLease | null = null;
  let watcher: ReturnType<typeof watchGeneration> | null = null;
  let admitted = false;
  try {
    if (!session.userId && !reviewExample) throw new GenerationAdmissionError("forbidden");
    if (session.userId) {
      const identity = await generationRequestIdentity(input, parsedInput);
      lease = { requestId: identity.requestId, scopeId: targetWorkspaceId, actorId: session.userId };
      const model = process.env.CAUSENT_DECISION_REPORT_MODEL?.trim() || DEFAULT_DECISION_REPORT_MODEL;
      const admission = await admitGeneration(getServiceRoleSupabase(), lease, identity.inputHash, model, Boolean(reviewExample));
      if (admission.status === "completed" && admission.result) {
        const generation = admission.result as MintedDecisionReportGeneration;
        if (!hasValidGenerationReceipt(generation)) throw new GenerationAdmissionError("expired");
        if (reviewExample) await writeActiveWorkspaceCookie(targetWorkspaceId);
        return { ok: true, generation };
      }
      if (admission.status !== "admitted") throw new GenerationAdmissionError(admission.status, admission.retryAfter);
      admitted = true;
      watcher = watchGeneration(getServiceRoleSupabase(), lease);
    }
    const sources = await prepareReportSourceCorpus({
      brief: prompt,
      url: sourceUrl || undefined,
      pdf,
    });
    const generation = await generateDecisionReportFromPrompt(prompt, {
      sources,
      forceFixture: Boolean(reviewExample),
      signal: watcher?.signal,
    });
    const scope = await getScope(targetWorkspaceId);
    const receipt = await mintDecisionReportSourceReceipt(
      getServiceRoleSupabase(),
      targetWorkspaceId,
      session.userId,
      generation.report,
    );
    if (!receipt.ok) {
      if (lease) await generationState(getServiceRoleSupabase(), lease, "fail");
      await emit("REPORT_GENERATION_FAILED");
      return receipt;
    }
    const minted: MintedDecisionReportGeneration = {
        ...generation,
        workspaceId: targetWorkspaceId,
        workspaceName: scope.project,
        projectName: scope.workspace,
        sourceReceiptId: receipt.sourceReceiptId,
        sourceReceiptExpiresAt: receipt.expiresAt,
    };
    if (lease) {
      watcher?.stop();
      const status = await generationState(getServiceRoleSupabase(), lease, "complete", minted);
      if (status !== "completed") throw new GenerationAdmissionError(status);
    }
    if (reviewExample) await writeActiveWorkspaceCookie(targetWorkspaceId);
    await emit("REPORT_EDITABLE", {
      usedUrl: Boolean(sourceUrl), usedPdf: Boolean(pdf), usedFallback: generation.mode === "fallback",
    });
    return { ok: true, generation: minted };
  } catch (error) {
    if (lease && admitted) await generationState(getServiceRoleSupabase(), lease, "fail").catch(() => {});
    await emit("REPORT_GENERATION_FAILED");
    return {
      ok: false,
      error:
        error instanceof ReportSourceInputError || error instanceof GenerationAdmissionError
          ? error.message
          : "Causent could not create this draft. Your inputs are unchanged; try again.",
      ...(error instanceof GenerationAdmissionError ? { code: error.code, retryAfter: error.retryAfter } : {}),
    };
  } finally {
    watcher?.stop();
  }
}

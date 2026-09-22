import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_GENERATION_REQUEST_BYTES = 300_000;
export const GENERATION_MODEL = "anthropic/claude-sonnet-5";
export const GENERATION_OUTPUT_TOKENS = 2_200;
export const GENERATION_REQUEST_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export class GenerationAdmissionError extends Error {
  readonly code: string;
  readonly retryAfter?: number;
  constructor(code: string, retryAfter?: number) {
    super(generationAdmissionMessage(code));
    this.name = "GenerationAdmissionError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function generationAdmissionMessage(code: string): string {
  switch (code) {
    case "busy": return "An AI request is still finishing. Try again shortly.";
    case "running": return "A report is already generating. Wait a moment or cancel it.";
    case "rate_limited": return "Too many requests. Try again in a minute.";
    case "budget_exhausted": return "Your team's daily AI budget is used. Try tomorrow or ask an administrator to raise it.";
    case "cancelled": case "cancel_requested": return "Generation cancelled. Your inputs are unchanged.";
    case "expired": case "failed": return "This request ended. Start a new generation to try again.";
    case "conflict": case "invalid_request": return "This request has changed. Start a new generation.";
    case "forbidden": return "You need editing access to generate a report here.";
    case "unpriced_model": return "This model has no approved AI budget. Ask an administrator to configure it.";
    case "input_too_large": return "These sources exceed the AI budget. Use a shorter source.";
    default: return "The AI budget check is unavailable. Try again shortly.";
  }
}

export async function generationRequestIdentity(input: string | FormData, parsed: {
  brief: string; url: string; pdf?: { bytes: Uint8Array };
}): Promise<{ requestId: string; inputHash: string }> {
  const raw = input instanceof FormData ? input.get("generationRequestId") : null;
  const requestId = raw === null ? randomUUID() : raw;
  if (typeof requestId !== "string" || !GENERATION_REQUEST_ID.test(requestId)) {
    throw new GenerationAdmissionError("invalid_request");
  }
  const hash = createHash("sha256").update(JSON.stringify([parsed.brief, parsed.url,
    input instanceof FormData ? input.get("reviewExampleId") : null]));
  if (parsed.pdf) hash.update(parsed.pdf.bytes);
  return { requestId, inputHash: hash.digest("hex") };
}

export type GenerationLease = { requestId: string; scopeId: string; actorId: string };
export function hasValidGenerationReceipt(value: { sourceReceiptExpiresAt?: string }, now = Date.now()): boolean {
  return typeof value.sourceReceiptExpiresAt === "string" && Date.parse(value.sourceReceiptExpiresAt) > now;
}
type Admission = { status: string; result?: unknown; retryAfter?: number };

export async function admitGeneration(client: SupabaseClient, lease: GenerationLease,
  inputHash: string, model: string, fixture: boolean): Promise<Admission> {
  const { data, error } = await client.rpc("admit_report_generation", {
    p_request: lease.requestId, p_scope: lease.scopeId, p_actor: lease.actorId,
    p_hash: inputHash, p_model: model, p_fixture: fixture,
  });
  if (error || !data || typeof data.status !== "string") throw new GenerationAdmissionError("unavailable");
  return data as Admission;
}

export async function generationState(client: SupabaseClient, lease: Omit<GenerationLease, "scopeId"> & { scopeId: string | null },
  operation: "read" | "complete" | "fail" | "cancel" = "read", result?: unknown): Promise<string> {
  const { data, error } = await client.rpc("report_generation_state", {
    p_request: lease.requestId, p_scope: lease.scopeId, p_actor: lease.actorId,
    p_operation: operation, p_result: result ?? null,
  });
  if (error || !data || typeof data.status !== "string") throw new GenerationAdmissionError("unavailable");
  return data.status;
}

/** Poll serially so cancellation works across server instances and cannot queue reads. */
export function watchGeneration(client: SupabaseClient, lease: GenerationLease) {
  const controller = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    try {
      const status = await generationState(client, lease);
      if (!stopped && status !== "running") controller.abort(new GenerationAdmissionError(status));
    } catch {
      if (!stopped) controller.abort(new GenerationAdmissionError("unavailable"));
    }
    if (!stopped && !controller.signal.aborted) timer = setTimeout(check, 1500);
  };
  void check();
  return { signal: controller.signal, stop() { stopped = true; clearTimeout(timer); } };
}

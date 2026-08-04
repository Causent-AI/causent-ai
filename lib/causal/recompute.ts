export type CausalRecomputeKick = {
  scopeId?: string;
  metricId?: string;
  limit?: number;
};

const RECOMPUTE_RESULT_STATUSES = [
  "PROCESSED",
  "UNCHANGED",
  "SUPERSEDED",
  "RETRY_SCHEDULED",
  "FAILED",
] as const;

type CausalRecomputeResultStatus = (typeof RECOMPUTE_RESULT_STATUSES)[number];

export type CausalRecomputeSummary = {
  ok: boolean;
  processed: number;
  unchanged: number;
  superseded: number;
  retry_scheduled: number;
  failed: number;
  total: number;
  results: Array<{
    activation_id: string;
    generation: number;
    status: CausalRecomputeResultStatus;
    detail: string;
  }>;
  truncated: boolean;
};

type TerminalFailureSummary = {
  failed: number;
  retryScheduled: number;
  total: number;
};

export type CausalRecomputeKickResult =
  | { ok: true; configured: true; status: number; body: CausalRecomputeSummary }
  | { ok: false; configured: false; error: "not_configured" }
  | {
      ok: false;
      configured: true;
      error: "unreachable" | "rejected" | "invalid_response";
      status?: number;
    }
  | {
      ok: false;
      configured: true;
      error: "terminal_failure";
      status: number;
      summary: TerminalFailureSummary;
    };

type KickOptions = {
  url?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SUMMARY_KEYS = [
  "failed",
  "ok",
  "processed",
  "results",
  "retry_scheduled",
  "superseded",
  "total",
  "truncated",
  "unchanged",
] as const;
const RESULT_KEYS = ["activation_id", "detail", "generation", "status"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Fail-closed parser for the private worker response; no response value is trusted. */
export function parseCausalRecomputeSummary(value: unknown): CausalRecomputeSummary | null {
  if (!isRecord(value) || !hasExactKeys(value, SUMMARY_KEYS)) return null;
  if (typeof value.ok !== "boolean" || typeof value.truncated !== "boolean") return null;

  const countKeys = [
    "processed",
    "unchanged",
    "superseded",
    "retry_scheduled",
    "failed",
    "total",
  ] as const;
  if (countKeys.some((key) => !isNonNegativeInteger(value[key]))) return null;
  if (!Array.isArray(value.results) || value.results.length > 20) return null;

  const results: CausalRecomputeSummary["results"] = [];
  for (const row of value.results) {
    if (!isRecord(row) || !hasExactKeys(row, RESULT_KEYS)) return null;
    if (typeof row.activation_id !== "string" || !UUID_PATTERN.test(row.activation_id)) {
      return null;
    }
    if (!Number.isInteger(row.generation) || (row.generation as number) < 1) return null;
    if (
      typeof row.status !== "string" ||
      !RECOMPUTE_RESULT_STATUSES.includes(row.status as CausalRecomputeResultStatus)
    ) {
      return null;
    }
    if (typeof row.detail !== "string" || row.detail.length > 200) return null;
    results.push({
      activation_id: row.activation_id,
      generation: row.generation as number,
      status: row.status as CausalRecomputeResultStatus,
      detail: row.detail,
    });
  }

  const processed = value.processed as number;
  const unchanged = value.unchanged as number;
  const superseded = value.superseded as number;
  const retryScheduled = value.retry_scheduled as number;
  const failed = value.failed as number;
  const total = value.total as number;
  if (processed + unchanged + superseded + retryScheduled + failed !== total) return null;
  if (value.ok !== (failed === 0)) return null;
  if (results.length > total || (!value.truncated && results.length !== total)) return null;

  return {
    ok: value.ok,
    processed,
    unchanged,
    superseded,
    retry_scheduled: retryScheduled,
    failed,
    total,
    results,
    truncated: value.truncated,
  };
}

/**
 * Best-effort wake-up for work already committed to the private DB queue.
 * Callers must preserve their source-write success when this returns `ok:false`;
 * the five-minute cron is the durable fallback.
 */
export async function kickCausalRecompute(
  input: CausalRecomputeKick = {},
  options: KickOptions = {},
): Promise<CausalRecomputeKickResult> {
  const url = options.url ?? process.env.CAUSENT_RECOMPUTE_URL;
  const secret = options.secret ?? process.env.CAUSENT_RECOMPUTE_SECRET;
  if (!url || !secret) return { ok: false, configured: false, error: "not_configured" };

  const payload: Record<string, unknown> = {};
  if (input.scopeId) payload.scope_id = input.scopeId;
  if (input.metricId) payload.metric_id = input.metricId;
  if (input.limit !== undefined) payload.limit = input.limit;

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-causent-recompute-secret": secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
      cache: "no-store",
    });
    const rawBody = await response.json().catch(() => null);
    const body = parseCausalRecomputeSummary(rawBody);
    if (body && body.failed > 0) {
      return {
        ok: false,
        configured: true,
        error: "terminal_failure",
        status: response.status,
        summary: {
          failed: body.failed,
          retryScheduled: body.retry_scheduled,
          total: body.total,
        },
      };
    }
    if (!response.ok) {
      return { ok: false, configured: true, error: "rejected", status: response.status };
    }
    if (!body) {
      return {
        ok: false,
        configured: true,
        error: "invalid_response",
        status: response.status,
      };
    }
    return { ok: true, configured: true, status: response.status, body };
  } catch {
    return { ok: false, configured: true, error: "unreachable" };
  }
}

export function logDeferredCausalRecompute(result: CausalRecomputeKickResult): void {
  if (result.ok) return;
  console.warn("[causal-recompute] immediate worker kick deferred", {
    event: "immediate_worker_kick_deferred",
    reason: result.error,
    status: "status" in result ? result.status : undefined,
    failed: result.error === "terminal_failure" ? result.summary.failed : undefined,
  });
}

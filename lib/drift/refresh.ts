export type DriftRefreshKick = {
  scopeId?: string;
  limit?: number;
};

const RESULT_STATUSES = [
  "PROCESSED",
  "SUPERSEDED",
  "RETRY_SCHEDULED",
  "FAILED",
] as const;
type ResultStatus = (typeof RESULT_STATUSES)[number];

export type DriftRefreshSummary = {
  ok: boolean;
  processed: number;
  superseded: number;
  retry_scheduled: number;
  failed: number;
  total: number;
  results: Array<{
    scope_id: string;
    generation: number;
    status: ResultStatus;
    detail: string;
  }>;
  truncated: boolean;
};

type TerminalFailureSummary = {
  failed: number;
  retryScheduled: number;
  total: number;
};

export type DriftRefreshKickResult =
  | { ok: true; configured: true; status: number; body: DriftRefreshSummary }
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
] as const;
const RESULT_KEYS = ["detail", "generation", "scope_id", "status"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseDriftRefreshSummary(value: unknown): DriftRefreshSummary | null {
  if (!isRecord(value) || !hasExactKeys(value, SUMMARY_KEYS)) return null;
  if (typeof value.ok !== "boolean" || typeof value.truncated !== "boolean") return null;
  if (
    !isNonNegativeInteger(value.processed) ||
    !isNonNegativeInteger(value.superseded) ||
    !isNonNegativeInteger(value.retry_scheduled) ||
    !isNonNegativeInteger(value.failed) ||
    !isNonNegativeInteger(value.total) ||
    !Array.isArray(value.results) ||
    value.results.length > 20
  ) {
    return null;
  }

  const results: DriftRefreshSummary["results"] = [];
  for (const raw of value.results) {
    if (!isRecord(raw) || !hasExactKeys(raw, RESULT_KEYS)) return null;
    if (typeof raw.scope_id !== "string" || !UUID_PATTERN.test(raw.scope_id)) return null;
    if (!Number.isInteger(raw.generation) || (raw.generation as number) < 1) return null;
    if (
      typeof raw.status !== "string" ||
      !RESULT_STATUSES.includes(raw.status as ResultStatus)
    ) {
      return null;
    }
    if (typeof raw.detail !== "string" || raw.detail.length > 200) return null;
    results.push({
      scope_id: raw.scope_id,
      generation: raw.generation as number,
      status: raw.status as ResultStatus,
      detail: raw.detail,
    });
  }

  const processed = value.processed;
  const superseded = value.superseded;
  const retryScheduled = value.retry_scheduled;
  const failed = value.failed;
  const total = value.total;
  if (processed + superseded + retryScheduled + failed !== total) return null;
  if (value.ok !== (failed === 0)) return null;
  if (results.length > total || (!value.truncated && results.length !== total)) return null;

  return {
    ok: value.ok,
    processed,
    superseded,
    retry_scheduled: retryScheduled,
    failed,
    total,
    results,
    truncated: value.truncated,
  };
}

export async function kickDriftRefresh(
  input: DriftRefreshKick = {},
  options: KickOptions = {},
): Promise<DriftRefreshKickResult> {
  const url = options.url ?? process.env.CAUSENT_DRIFT_URL;
  const secret = options.secret ?? process.env.CAUSENT_DRIFT_SECRET;
  if (!url || !secret) return { ok: false, configured: false, error: "not_configured" };

  const payload: Record<string, unknown> = {};
  if (input.scopeId) payload.scope_id = input.scopeId;
  if (input.limit !== undefined) payload.limit = input.limit;

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-causent-drift-secret": secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
      cache: "no-store",
    });
    const rawBody = await response.json().catch(() => null);
    const body = parseDriftRefreshSummary(rawBody);
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

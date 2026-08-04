import type { SupabaseClient } from "@supabase/supabase-js";

export type CausalRecomputeState =
  | "idle"
  | "queued"
  | "retrying"
  | "current"
  | "failed";

export type CausalRecomputeStatus = {
  state: CausalRecomputeState;
  requestedAt: string | null;
  lastProcessedAt: string | null;
  nextAttemptAt: string | null;
};

type StatusRow = {
  status: unknown;
  requested_at: unknown;
  last_processed_at: unknown;
  next_attempt_at: unknown;
};

const STATES = new Set<CausalRecomputeState>([
  "idle",
  "queued",
  "retrying",
  "current",
  "failed",
]);

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Invalid causal recompute status timestamp.");
  }
  return value;
}

export function parseCausalRecomputeStatusRow(
  value: unknown,
): CausalRecomputeStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid causal recompute status response.");
  }
  const row = value as StatusRow;
  if (typeof row.status !== "string" || !STATES.has(row.status as CausalRecomputeState)) {
    throw new Error("Invalid causal recompute status state.");
  }
  return {
    state: row.status as CausalRecomputeState,
    requestedAt: nullableTimestamp(row.requested_at),
    lastProcessedAt: nullableTimestamp(row.last_processed_at),
    nextAttemptAt: nullableTimestamp(row.next_attempt_at),
  };
}

export async function loadCurrentCausalRecomputeStatus(
  sb: SupabaseClient,
  scopeId: string,
): Promise<CausalRecomputeStatus | null> {
  const response = await sb.rpc("get_current_causal_recompute_status_v1", {
    p_scope_id: scopeId,
  });
  if (response.error) throw response.error;
  const rows = response.data as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("Invalid causal recompute status response.");
  }
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Ambiguous causal recompute status response.");
  }
  return parseCausalRecomputeStatusRow(rows[0]);
}

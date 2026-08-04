// Funnel instrumentation — the IO half (C2/#15, C5/#18).
//
// The Supabase client is INJECTED (same pattern as lib/onboarding/commit.ts) so
// the writer runs under the app's server client AND under an integration test's
// own client, and the module stays importable outside the Next runtime. The
// server clock stamps created_at (never hand-picked); the caller supplies only
// the client-measured ms_since_start.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DECISION_REPORT_FUNNEL_EVENT_TYPES,
  DECISION_REPORT_FUNNEL_META_KEYS,
  computeDecisionReportFunnelMetrics,
  computeFunnelMetrics,
  isDecisionReportFunnelEventType,
  type DecisionReportFunnelEventType,
  type DecisionReportFunnelMeta,
  type DecisionReportFunnelMetrics,
  type FunnelEventRow,
  type FunnelEventType,
  type FunnelMetrics,
} from "../funnel/events.ts";

export type RecordFunnelEventInput = {
  sessionKey: string;
  eventType: FunnelEventType;
  step?: string | null;
  msSinceStart?: number | null;
  meta?: Record<string, unknown> | null;
};

export type RecordDecisionReportFunnelEventInput = {
  sessionKey: string;
  eventType: DecisionReportFunnelEventType;
  msSinceStart?: number | null;
  meta?: DecisionReportFunnelMeta | null;
};

export type FunnelEventWriteResult = { ok: true } | { ok: false; error: string };

const DECISION_REPORT_SESSION_KEY_PATTERN =
  /^dr-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISION_REPORT_MAX_COUNT = 10_000;
// `ms_since_start` is a Postgres integer. Seven days is ample for the bounded
// partner funnel while rejecting accidental wall-clock timestamps.
const DECISION_REPORT_MAX_ELAPSED_MS = 7 * 24 * 60 * 60 * 1_000;
const DECISION_REPORT_META_KEY_SET = new Set<string>(DECISION_REPORT_FUNNEL_META_KEYS);
const DECISION_REPORT_COUNT_META_KEYS = new Set<string>([
  "editCount",
  "followUpCount",
  "missingFieldCount",
]);
const DECISION_REPORT_BOOLEAN_META_KEYS = new Set<string>([
  "usedUrl",
  "usedPdf",
  "usedFallback",
  "reused",
]);

/** Mint a content-free opaque key for one Decision Report funnel run. */
export function createDecisionReportFunnelSessionKey(): string {
  return `dr-${crypto.randomUUID()}`;
}

function sanitizedDecisionReportMeta(
  value: unknown,
): { ok: true; meta: DecisionReportFunnelMeta | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, meta: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false };

  const meta: DecisionReportFunnelMeta = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!DECISION_REPORT_META_KEY_SET.has(key)) return { ok: false };
    if (DECISION_REPORT_COUNT_META_KEYS.has(key)) {
      if (
        typeof entry !== "number" ||
        !Number.isSafeInteger(entry) ||
        entry < 0 ||
        entry > DECISION_REPORT_MAX_COUNT
      ) return { ok: false };
      Object.assign(meta, { [key]: entry });
      continue;
    }
    if (!DECISION_REPORT_BOOLEAN_META_KEYS.has(key) || typeof entry !== "boolean") {
      return { ok: false };
    }
    Object.assign(meta, { [key]: entry });
  }
  return { ok: true, meta };
}

function validateDecisionReportFunnelInput(
  input: RecordDecisionReportFunnelEventInput,
):
  | {
      ok: true;
      input: {
        sessionKey: string;
        eventType: DecisionReportFunnelEventType;
        msSinceStart: number | null;
        meta: DecisionReportFunnelMeta | null;
      };
    }
  | { ok: false; error: string } {
  if (!DECISION_REPORT_SESSION_KEY_PATTERN.test(input.sessionKey)) {
    return { ok: false, error: "Decision Report telemetry session key is invalid." };
  }
  if (!isDecisionReportFunnelEventType(input.eventType)) {
    return { ok: false, error: "Decision Report telemetry event type is invalid." };
  }
  const msSinceStart = input.msSinceStart ?? null;
  if (
    msSinceStart !== null &&
    (
      typeof msSinceStart !== "number" ||
      !Number.isSafeInteger(msSinceStart) ||
      msSinceStart < 0 ||
      msSinceStart > DECISION_REPORT_MAX_ELAPSED_MS
    )
  ) {
    return { ok: false, error: "Decision Report telemetry elapsed time is invalid." };
  }
  const metadata = sanitizedDecisionReportMeta(input.meta);
  if (!metadata.ok) {
    return { ok: false, error: "Decision Report telemetry metadata is invalid." };
  }
  return {
    ok: true,
    input: {
      sessionKey: input.sessionKey,
      eventType: input.eventType,
      msSinceStart,
      meta: metadata.meta,
    },
  };
}

async function insertFunnelEvent(
  sb: SupabaseClient,
  scopeId: string,
  userId: string | null,
  input: RecordFunnelEventInput,
): Promise<FunnelEventWriteResult> {
  const { error } = await sb.from("funnel_events").insert({
    scope_id: scopeId,
    user_id: userId,
    session_key: input.sessionKey,
    event_type: input.eventType,
    step: input.step ?? null,
    ms_since_start:
      typeof input.msSinceStart === "number" && Number.isFinite(input.msSinceStart)
        ? Math.round(input.msSinceStart)
        : null,
    meta: input.meta ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Append one funnel event. Best-effort by contract: instrumentation must never
 *  break the funnel, so callers ignore the boolean — but we return it for tests. */
export async function recordFunnelEvent(
  sb: SupabaseClient,
  scopeId: string,
  userId: string | null,
  input: RecordFunnelEventInput,
): Promise<FunnelEventWriteResult> {
  if (isDecisionReportFunnelEventType(input.eventType)) {
    return {
      ok: false,
      error: "Use the bounded Decision Report telemetry writer for report events.",
    };
  }
  return insertFunnelEvent(sb, scopeId, userId, input);
}

/**
 * Append one bounded Decision Report lifecycle event. Unlike the legacy writer,
 * this path accepts only opaque session keys plus an explicit numeric/boolean
 * metadata allowlist. Unknown keys or string/object values fail before IO.
 */
export async function recordDecisionReportFunnelEvent(
  sb: SupabaseClient,
  scopeId: string,
  userId: string | null,
  input: RecordDecisionReportFunnelEventInput,
): Promise<FunnelEventWriteResult> {
  const validation = validateDecisionReportFunnelInput(input);
  if (!validation.ok) return validation;
  return insertFunnelEvent(sb, scopeId, userId, {
    sessionKey: validation.input.sessionKey,
    eventType: validation.input.eventType,
    step: null,
    msSinceStart: validation.input.msSinceStart,
    meta: validation.input.meta,
  });
}

/** Resolution-return rate (#18): of the scope's RESOLVED predictions, the
 *  fraction whose scorecard has been viewed at least once. Prediction-keyed (via
 *  SCORECARD_VIEW meta.prediction_id) so it survives across browser sessions —
 *  distinct from computeFunnelMetrics' funnel-session return rate. Returns null
 *  when nothing has resolved yet. */
export async function getResolutionReturnRate(
  sb: SupabaseClient,
  scopeId: string,
): Promise<{ resolved: number; returned: number; rate: number | null }> {
  const [resolvedRes, viewsRes] = await Promise.all([
    sb
      .from("predictions")
      .select("prediction_id", { count: "exact", head: true })
      .eq("scope_id", scopeId)
      .not("resolved_at", "is", null),
    sb
      .from("funnel_events")
      .select("meta")
      .eq("scope_id", scopeId)
      .eq("event_type", "SCORECARD_VIEW"),
  ]);
  if (viewsRes.error) throw viewsRes.error;
  const resolved = resolvedRes.count ?? 0;
  const viewed = new Set<string>();
  for (const r of (viewsRes.data ?? []) as Array<{ meta: { prediction_id?: string } | null }>) {
    const pid = r.meta?.prediction_id;
    if (pid) viewed.add(pid);
  }
  return {
    resolved,
    returned: viewed.size,
    rate: resolved === 0 ? null : viewed.size / resolved,
  };
}

/** Read the scope's funnel events and fold them into the DoD metrics. */
export async function getFunnelMetrics(
  sb: SupabaseClient,
  scopeId: string,
): Promise<FunnelMetrics> {
  const { data, error } = await sb
    .from("funnel_events")
    .select("session_key, event_type, step, ms_since_start")
    .eq("scope_id", scopeId);
  if (error) throw error;
  const rows: FunnelEventRow[] = (
    (data ?? []) as Array<{
      session_key: string;
      event_type: FunnelEventType;
      step: string | null;
      ms_since_start: number | null;
    }>
  ).map((r) => ({
    sessionKey: r.session_key,
    eventType: r.event_type,
    step: r.step,
    msSinceStart: r.ms_since_start,
  }));
  return computeFunnelMetrics(rows);
}

/** Read and fold only the Decision Report lifecycle events for one workspace. */
export async function getDecisionReportFunnelMetrics(
  sb: SupabaseClient,
  scopeId: string,
): Promise<DecisionReportFunnelMetrics> {
  const { data, error } = await sb
    .from("funnel_events")
    .select("session_key, event_type, step, ms_since_start, meta")
    .eq("scope_id", scopeId)
    .in("event_type", [...DECISION_REPORT_FUNNEL_EVENT_TYPES]);
  if (error) throw error;
  const rows = (
    (data ?? []) as Array<{
      session_key: string;
      event_type: string;
      step: string | null;
      ms_since_start: number | null;
      meta: Record<string, unknown> | null;
    }>
  ).flatMap((row): FunnelEventRow[] => {
    if (!isDecisionReportFunnelEventType(row.event_type)) return [];
    return [{
      sessionKey: row.session_key,
      eventType: row.event_type,
      step: row.step,
      msSinceStart: row.ms_since_start,
      meta: row.meta,
    }];
  });
  return computeDecisionReportFunnelMetrics(rows);
}

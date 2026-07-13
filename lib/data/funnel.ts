// Funnel instrumentation — the IO half (C2/#15, C5/#18).
//
// The Supabase client is INJECTED (same pattern as lib/onboarding/commit.ts) so
// the writer runs under the app's server client AND under an integration test's
// own client, and the module stays importable outside the Next runtime. The
// server clock stamps created_at (never hand-picked); the caller supplies only
// the client-measured ms_since_start.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFunnelMetrics,
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

/** Append one funnel event. Best-effort by contract: instrumentation must never
 *  break the funnel, so callers ignore the boolean — but we return it for tests. */
export async function recordFunnelEvent(
  sb: SupabaseClient,
  scopeId: string,
  userId: string | null,
  input: RecordFunnelEventInput,
): Promise<{ ok: boolean; error?: string }> {
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

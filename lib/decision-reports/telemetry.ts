import type { SupabaseClient } from "@supabase/supabase-js";

import {
  recordDecisionReportFunnelEvent,
  type RecordDecisionReportFunnelEventInput,
} from "../data/funnel.ts";

export type DecisionReportTelemetryContext = {
  client: SupabaseClient;
  scopeId: string;
  userId: string | null;
};

/**
 * Server-side best-effort seam for Decision Report lifecycle instrumentation.
 * Product writes must never depend on analytics availability, so both rejected
 * telemetry and transport/database failures are deliberately swallowed.
 *
 * Callers may pass only the bounded event input enforced by
 * recordDecisionReportFunnelEvent: an opaque session key, elapsed milliseconds,
 * and whitelisted numeric/boolean metadata. No report or source payload belongs
 * on this seam.
 */
export async function recordDecisionReportTelemetry(
  context: DecisionReportTelemetryContext,
  input: RecordDecisionReportFunnelEventInput,
): Promise<void> {
  try {
    await recordDecisionReportFunnelEvent(
      context.client,
      context.scopeId,
      context.userId,
      input,
    );
  } catch {
    // Instrumentation is intentionally non-critical and must not break the flow.
  }
}

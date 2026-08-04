"use server";

import { getSession } from "@/lib/auth/session";
import type { RecordDecisionReportFunnelEventInput } from "@/lib/data/funnel";
import { recordDecisionReportTelemetry } from "@/lib/decision-reports/telemetry";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

/**
 * Best-effort client-to-server lifecycle event seam. The repository performs
 * the runtime allowlist validation; malformed or unavailable telemetry is
 * intentionally ignored so it can never interrupt the report workflow.
 */
export async function recordDecisionReportTelemetryAction(
  input: RecordDecisionReportFunnelEventInput,
): Promise<void> {
  try {
    const session = await getSession();
    if (!isLocalDemo() && !session.userId) return;
    await recordDecisionReportTelemetry({
      client: await getServerSupabase(),
      scopeId: session.workspaceId,
      userId: session.userId,
    }, input);
  } catch {
    // Telemetry is non-critical by contract.
  }
}

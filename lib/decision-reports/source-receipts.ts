import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validateDecisionReport, type DecisionReportV1 } from "./schema.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SourceReceiptRow = {
  source_receipt_id: string;
  expires_at: string;
};

export type MintDecisionReportSourceReceiptResult =
  | { ok: true; sourceReceiptId: string; expiresAt: string }
  | { ok: false; error: string };

/**
 * Mint the opaque, actor-bound capability used by the first persisted v2
 * revision. Call this only with a service-role client after trusted generation;
 * the database revokes the RPC from every application role.
 */
export async function mintDecisionReportSourceReceipt(
  serviceRoleClient: SupabaseClient,
  scopeId: string,
  authoredBy: string | null,
  generatedReport: DecisionReportV1,
): Promise<MintDecisionReportSourceReceiptResult> {
  const validation = validateDecisionReport(generatedReport);
  if (
    !UUID_PATTERN.test(scopeId) ||
    (authoredBy !== null && !UUID_PATTERN.test(authoredBy)) ||
    !validation.success ||
    validation.data.schemaVersion !== 2
  ) {
    return { ok: false, error: "Generated Decision Report provenance is invalid." };
  }

  const response = await serviceRoleClient.rpc(
    "mint_decision_report_source_receipt_v1",
    {
      p_scope_id: scopeId,
      p_authored_by: authoredBy,
      p_generated_snapshot: validation.data,
    },
  );
  if (response.error) {
    console.error("[decision-report provenance] receipt mint failed", response.error);
    return { ok: false, error: "Causent could not secure this generated draft." };
  }
  if (!Array.isArray(response.data) || response.data.length !== 1) {
    console.error("[decision-report provenance] invalid receipt response", {
      rowCount: Array.isArray(response.data) ? response.data.length : null,
    });
    return { ok: false, error: "Causent could not secure this generated draft." };
  }

  const row = response.data[0] as Partial<SourceReceiptRow>;
  if (
    typeof row.source_receipt_id !== "string" ||
    !UUID_PATTERN.test(row.source_receipt_id) ||
    typeof row.expires_at !== "string" ||
    Number.isNaN(Date.parse(row.expires_at))
  ) {
    console.error("[decision-report provenance] malformed receipt response");
    return { ok: false, error: "Causent could not secure this generated draft." };
  }

  return {
    ok: true,
    sourceReceiptId: row.source_receipt_id,
    expiresAt: row.expires_at,
  };
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { createSafeFallbackReport } from "./generation-contract.ts";
import { cloneDecisionReport } from "./schema.ts";
import {
  deleteDecisionReport,
  loadDecisionReport,
  saveDecisionReport,
  startDecisionReportIteration,
} from "./persistence.ts";

const SCOPE_ID = "ca5e0000-0000-0000-0000-0000000000d3";
const REPORT_ID = "ca5e0000-0000-0000-0000-0000000000e1";
const REVISION_ID = "ca5e0000-0000-0000-0000-0000000000e2";
const SOURCE_RECEIPT_ID = "ca5e0000-0000-0000-0000-0000000000e3";

function rpcClient(calls: Array<{ name: string; args: Record<string, unknown> }>): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: [{
          report_id: REPORT_ID,
          revision_id: REVISION_ID,
          base_revision_id: null,
          status: args.p_status,
          content_hash: "a".repeat(32),
          reused: false,
          saved_at: "2026-07-21T12:00:00.000Z",
        }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
}

function staleConflictClient(): SupabaseClient {
  return {
    async rpc() {
      return {
        data: null,
        error: {
          code: "PT409",
          message: "STALE_REVISION",
          details: REVISION_ID,
          hint: null,
          name: "PostgrestError",
        },
      };
    },
  } as unknown as SupabaseClient;
}

function unavailableSourceReceiptClient(): SupabaseClient {
  return {
    async rpc() {
      return {
        data: null,
        error: {
          code: "42501",
          message: "Report source receipt is unavailable.",
          details: null,
          hint: null,
          name: "PostgrestError",
        },
      };
    },
  } as unknown as SupabaseClient;
}

test("save derives report_ready and calls the create RPC for a new complete report", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: "ca5e0000-0000-0000-0000-000000000073",
    selectedActionSourceItemIds: [actionId],
    primaryLeverActionSourceItemId: actionId,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: 14,
      resolutionDate: "2099-12-15",
    },
  };
  const result = await saveDecisionReport(rpcClient(calls), SCOPE_ID, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: SOURCE_RECEIPT_ID,
    report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "create_decision_report_v2");
  assert.equal(calls[0].args.p_source_receipt_id, SOURCE_RECEIPT_ID);
  assert.equal(calls[0].args.p_status, "report_ready");
  assert.deepEqual(
    (calls[0].args.p_snapshot as typeof report).activationDraft,
    report.activationDraft,
  );
});

test("save derives report_ready without evidence and draft without background", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const noEvidence = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  noEvidence.supportingEvidence.factors = [{
    ...noEvidence.supportingEvidence.factors[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  }];

  const ready = await saveDecisionReport(rpcClient(calls), SCOPE_ID, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: SOURCE_RECEIPT_ID,
    report: noEvidence,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(ready.ok, true);
  assert.equal(calls[0].args.p_status, "report_ready");

  const missingBackground = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  missingBackground.decision.background[0] = {
    ...missingBackground.decision.background[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  };
  const draftResult = await saveDecisionReport(rpcClient(calls), SCOPE_ID, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: SOURCE_RECEIPT_ID,
    report: missingBackground,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(draftResult.ok, true);
  assert.equal(calls[1].args.p_status, "draft");
});

test("save derives draft for the sparse fallback", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let index = 0;
  const fallback = createSafeFallbackReport("Launch a new partner onboarding experience.", {
    idFactory: () => `fallback-${index++}`,
  });
  const result = await saveDecisionReport(rpcClient(calls), SCOPE_ID, {
    reportId: null,
    baseRevisionId: null,
    report: fallback.report,
    metricProjection: fallback.metricProjection,
    authoredBy: null,
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].args.p_status, "draft");
});

test("save rejects invalid revision addresses before touching the database", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await saveDecisionReport(rpcClient(calls), SCOPE_ID, {
    reportId: REPORT_ID,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "validation");
  assert.equal(calls.length, 0);
});

test("an untrusted initial save requires a server-minted source receipt", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await saveDecisionReport(rpcClient(calls), SCOPE_ID, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "validation");
  assert.equal(calls.length, 0);
});

test("an expired or unavailable receipt returns an actionable regeneration path", async () => {
  const result = await saveDecisionReport(unavailableSourceReceiptClient(), SCOPE_ID, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: SOURCE_RECEIPT_ID,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "forbidden");
    assert.match(result.error, /Generate the draft again/);
  }
});

test("save maps an immediate PostgREST 409 to a revision conflict", async () => {
  const result = await saveDecisionReport(staleConflictClient(), SCOPE_ID, {
    reportId: REPORT_ID,
    baseRevisionId: REVISION_ID,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "conflict");
    assert.equal(result.currentRevisionId, REVISION_ID);
  }
});

test("delete calls the checked RPC and validates its receipt", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: [{ report_id: REPORT_ID, deleted_at: "2026-07-22T20:00:00Z", reused: false }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const result = await deleteDecisionReport(client, SCOPE_ID, REPORT_ID, null);
  assert.equal(result.ok, true);
  assert.equal(calls[0].name, "delete_decision_report_v1");
  assert.deepEqual(calls[0].args, {
    p_scope_id: SCOPE_ID,
    p_report_id: REPORT_ID,
    p_authored_by: null,
  });
});

test("unknown database errors stay in server logs and never expose constraint names", async () => {
  const rawMessage =
    'insert violates foreign key constraint "decision_report_series_scope_id_fkey"';
  const client = {
    async rpc() {
      return {
        data: null,
        error: {
          code: "23503",
          message: rawMessage,
          details: "Sensitive database details",
          hint: null,
          name: "PostgrestError",
        },
      };
    },
  } as unknown as SupabaseClient;
  const loadClient = {
    from() {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        is() {
          return query;
        },
        async maybeSingle() {
          return {
            data: null,
            error: {
              code: "23503",
              message: rawMessage,
              details: "Sensitive database details",
              hint: null,
              name: "PostgrestError",
            },
          };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => logged.push(args);

  try {
    const saved = await saveDecisionReport(client, SCOPE_ID, {
      reportId: null,
      baseRevisionId: null,
      report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
      metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
      authoredBy: null,
    });
    const started = await startDecisionReportIteration(
      client,
      SCOPE_ID,
      REPORT_ID,
      "Refresh the assumptions",
      null,
    );
    const deleted = await deleteDecisionReport(client, SCOPE_ID, REPORT_ID, null);
    const loaded = await loadDecisionReport(loadClient, SCOPE_ID, REPORT_ID);

    for (const result of [saved, started, deleted, loaded]) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "database");
        assert.doesNotMatch(result.error, /constraint|foreign key|decision_report_series/i);
      }
    }
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logged.length, 4);
  assert.match(JSON.stringify(logged), /decision_report_series_scope_id_fkey/);
});

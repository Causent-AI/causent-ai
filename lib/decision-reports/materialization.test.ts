import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  materializeReportActivation,
  type MaterializeReportActivationResult,
} from "./materialization.ts";
import type { ReportActivationInputV1 } from "./activation.ts";

const INPUT: ReportActivationInputV1 = {
  schemaVersion: 1,
  reportId: "ca5e0000-0000-0000-0000-0000000000a1",
  revisionId: "ca5e0000-0000-0000-0000-0000000000a2",
  confirmedMetricId: "ca5e0000-0000-0000-0000-0000000000a3",
  prediction: {
    direction: "POSITIVE",
    magnitudePctMean: 15,
    resolutionDate: "2026-12-15",
  },
  selectedActionSourceItemIds: ["gummy-action-1", "gummy-action-2"],
};

const IDS = {
  activation: "ca5e0000-0000-0000-0000-0000000000b1",
  decision: "ca5e0000-0000-0000-0000-0000000000b2",
  prediction: "ca5e0000-0000-0000-0000-0000000000b3",
  action1: "ca5e0000-0000-0000-0000-0000000000b4",
  action2: "ca5e0000-0000-0000-0000-0000000000b5",
} as const;

function rpcClient(
  handler: (args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return handler(args);
    },
  } as unknown as SupabaseClient;
}

test("activation sends one complete packet to the checked materialization RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({
    data: [{
      activation_id: IDS.activation,
      decision_id: IDS.decision,
      prediction_id: IDS.prediction,
      action_ids: [IDS.action1, IDS.action2],
      reused: false,
      activated_at: "2026-07-22T06:30:00.000Z",
    }],
    error: null,
  }), calls);

  const result = await materializeReportActivation(client, INPUT, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.activation.decisionId, IDS.decision);
  assert.deepEqual(result.activation.actionIds, [IDS.action1, IDS.action2]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "activate_decision_report_v1");
  assert.deepEqual(calls[0].args, {
    p_report_id: INPUT.reportId,
    p_revision_id: INPUT.revisionId,
    p_metric_id: INPUT.confirmedMetricId,
    p_prediction_direction: "POSITIVE",
    p_prediction_magnitude_pct_mean: 15,
    p_prediction_resolution_date: "2026-12-15",
    p_selected_action_source_ids: ["gummy-action-1", "gummy-action-2"],
    p_activated_by: null,
  });
});

test("invalid activation input never reaches the database", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({ data: null, error: null }), calls);
  const result = await materializeReportActivation(client, {
    ...INPUT,
    selectedActionSourceItemIds: [],
  }, null);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "validation");
  assert.equal(calls.length, 0);
});

test("a changed retry maps the database conflict without retrying", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({
    data: null,
    error: {
      code: "PT409",
      message: "REPORT_ALREADY_ACTIVE",
      details: IDS.activation,
    },
  }), calls);

  const result: MaterializeReportActivationResult = await materializeReportActivation(
    client,
    INPUT,
    null,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "conflict");
    assert.equal(result.activationId, IDS.activation);
  }
  assert.equal(calls.length, 1);
});

test("malformed canonical identities fail closed", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({
    data: [{
      activation_id: IDS.activation,
      decision_id: "not-a-uuid",
      prediction_id: IDS.prediction,
      action_ids: [IDS.action1],
      reused: false,
      activated_at: "2026-07-22T06:30:00.000Z",
    }],
    error: null,
  }), calls);

  const result = await materializeReportActivation(client, INPUT, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "database");
});

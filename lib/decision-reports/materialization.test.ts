import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authorizeReportActivationTarget,
  loadReportActivationMetrics,
  materializeReportActivation,
  resolveActivatedReportAction,
  validateReportActionStartTarget,
  type MaterializeReportActivationResult,
} from "./materialization.ts";
import type {
  ReportActivationInputV1,
  ReportActivationInputV2,
} from "./activation.ts";

const INPUT: ReportActivationInputV1 = {
  schemaVersion: 1,
  reportId: "ca5e0000-0000-0000-0000-0000000000a1",
  revisionId: "ca5e0000-0000-0000-0000-0000000000a2",
  confirmedMetricId: "ca5e0000-0000-0000-0000-0000000000a3",
  prediction: {
    direction: "POSITIVE",
    magnitudePctMean: 15,
    resolutionDate: "2099-12-15",
  },
  selectedActionSourceItemIds: ["gummy-action-1", "gummy-action-2"],
  primaryLeverActionSourceItemId: "gummy-action-1",
};

const IDS = {
  activation: "ca5e0000-0000-0000-0000-0000000000b1",
  decision: "ca5e0000-0000-0000-0000-0000000000b2",
  prediction: "ca5e0000-0000-0000-0000-0000000000b3",
  action1: "ca5e0000-0000-0000-0000-0000000000b4",
  action2: "ca5e0000-0000-0000-0000-0000000000b5",
  action3: "ca5e0000-0000-0000-0000-0000000000b6",
  action4: "ca5e0000-0000-0000-0000-0000000000b7",
  metric2: "ca5e0000-0000-0000-0000-0000000000b8",
  workspace: "ca5e0000-0000-0000-0000-0000000000b9",
} as const;

const INPUT_V2: ReportActivationInputV2 = {
  ...INPUT,
  schemaVersion: 2,
  selectedMetricIds: [INPUT.confirmedMetricId, IDS.metric2],
  selectedActionSourceItemIds: [
    "gummy-action-1",
    "gummy-action-2",
    "gummy-action-3",
    "gummy-action-4",
  ],
  actionMetricAssignments: [
    { actionSourceItemId: "gummy-action-1", metricId: INPUT.confirmedMetricId },
    { actionSourceItemId: "gummy-action-2", metricId: IDS.metric2 },
    { actionSourceItemId: "gummy-action-3", metricId: IDS.metric2 },
    { actionSourceItemId: "gummy-action-4", metricId: INPUT.confirmedMetricId },
  ],
};

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

function bindingClient(
  result: {
    data: unknown;
    error: { code?: string; message?: string } | null;
  },
  calls: Array<{
    table: string;
    columns: string;
    filters: Array<[string, unknown]>;
  }>,
): SupabaseClient {
  return {
    from(table: string) {
      const call = {
        table,
        columns: "",
        filters: [] as Array<[string, unknown]>,
      };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          return result;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function activationTargetClient(
  result: {
    data: unknown;
    error: { code?: string; message?: string } | null;
  },
  calls: Array<{
    table: string;
    columns: string;
    filters: Array<[string, string, unknown]>;
  }>,
): SupabaseClient {
  return {
    from(table: string) {
      const call = {
        table,
        columns: "",
        filters: [] as Array<[string, string, unknown]>,
      };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          call.filters.push(["is", column, value]);
          return builder;
        },
        async maybeSingle() {
          return result;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

test("action-start intent accepts only one selected report action", () => {
  assert.deepEqual(
    validateReportActionStartTarget(
      "gummy-action-2",
      INPUT_V2.selectedActionSourceItemIds,
    ),
    { success: true, actionSourceItemId: "gummy-action-2" },
  );
  for (const requested of [
    "forged-action",
    "",
    "gummy-action-2\u0000",
    "x".repeat(501),
    null,
  ]) {
    const result = validateReportActionStartTarget(
      requested,
      INPUT_V2.selectedActionSourceItemIds,
    );
    assert.equal(result.success, false, String(requested));
  }
});

test("activation target authorization binds the exact current revision to the session workspace", async () => {
  const calls: Array<{
    table: string;
    columns: string;
    filters: Array<[string, string, unknown]>;
  }> = [];
  const result = await authorizeReportActivationTarget(
    activationTargetClient({ data: { report_id: INPUT.reportId }, error: null }, calls),
    {
      scopeId: IDS.workspace,
      reportId: INPUT.reportId,
      revisionId: INPUT.revisionId,
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{
    table: "decision_reports",
    columns: "report_id",
    filters: [
      ["eq", "scope_id", IDS.workspace],
      ["eq", "report_id", INPUT.reportId],
      ["eq", "current_revision_id", INPUT.revisionId],
      ["is", "deleted_at", null],
    ],
  }]);
});

test("activation target authorization hides cross-workspace and stale reports", async () => {
  for (const data of [null, { report_id: IDS.action1 }]) {
    const result = await authorizeReportActivationTarget(
      activationTargetClient({ data, error: null }, []),
      {
        scopeId: IDS.workspace,
        reportId: INPUT.reportId,
        revisionId: INPUT.revisionId,
      },
    );
    assert.deepEqual(result, {
      ok: false,
      code: "forbidden",
      error: "This report is unavailable in the current workspace.",
    });
  }

  const denied = await authorizeReportActivationTarget(
    activationTargetClient({ data: null, error: { code: "42501" } }, []),
    {
      scopeId: IDS.workspace,
      reportId: INPUT.reportId,
      revisionId: INPUT.revisionId,
    },
  );
  assert.deepEqual(denied, {
    ok: false,
    code: "forbidden",
    error: "This report is unavailable in the current workspace.",
  });
});

test("activated action resolution is workspace scoped and returns only a canonical action", async () => {
  const calls: Array<{
    table: string;
    columns: string;
    filters: Array<[string, unknown]>;
  }> = [];
  const result = await resolveActivatedReportAction(
    bindingClient({ data: { action_id: IDS.action2 }, error: null }, calls),
    {
      scopeId: INPUT.reportId,
      activationId: IDS.activation,
      actionSourceItemId: "gummy-action-2",
      expectedActionIds: [IDS.action1, IDS.action2],
    },
  );

  assert.deepEqual(result, { ok: true, actionId: IDS.action2 });
  assert.deepEqual(calls, [{
    table: "decision_report_activation_action_metrics",
    columns: "action_id",
    filters: [
      ["scope_id", INPUT.reportId],
      ["activation_id", IDS.activation],
      ["action_source_item_id", "gummy-action-2"],
    ],
  }]);
});

test("activated action resolution fails closed for hidden and inconsistent bindings", async () => {
  const hidden = await resolveActivatedReportAction(
    bindingClient({ data: null, error: null }, []),
    {
      scopeId: INPUT.reportId,
      activationId: IDS.activation,
      actionSourceItemId: "gummy-action-2",
      expectedActionIds: [IDS.action1, IDS.action2],
    },
  );
  assert.deepEqual(hidden, {
    ok: false,
    code: "forbidden",
    error: "This action is unavailable in the current workspace.",
  });

  const inconsistent = await resolveActivatedReportAction(
    bindingClient({ data: { action_id: IDS.action3 }, error: null }, []),
    {
      scopeId: INPUT.reportId,
      activationId: IDS.activation,
      actionSourceItemId: "gummy-action-2",
      expectedActionIds: [IDS.action1, IDS.action2],
    },
  );
  assert.equal(inconsistent.ok, false);
  if (!inconsistent.ok) assert.equal(inconsistent.code, "database");

  const denied = await resolveActivatedReportAction(
    bindingClient({ data: null, error: { code: "42501" } }, []),
    {
      scopeId: INPUT.reportId,
      activationId: IDS.activation,
      actionSourceItemId: "gummy-action-2",
      expectedActionIds: [IDS.action1, IDS.action2],
    },
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "forbidden");
});

test("activation sends one complete packet to the checked materialization RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({
    data: [{
      activation_id: IDS.activation,
      decision_id: IDS.decision,
      prediction_id: IDS.prediction,
      action_ids: [IDS.action1, IDS.action2],
      primary_lever_action_id: IDS.action1,
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
  assert.equal(result.activation.primaryLeverActionId, IDS.action1);
  assert.equal(calls[0].name, "activate_decision_report_v2");
  assert.deepEqual(calls[0].args, {
    p_report_id: INPUT.reportId,
    p_revision_id: INPUT.revisionId,
    p_metric_id: INPUT.confirmedMetricId,
    p_prediction_direction: "POSITIVE",
    p_prediction_magnitude_pct_mean: 15,
    p_prediction_resolution_date: "2099-12-15",
    p_selected_action_source_ids: ["gummy-action-1", "gummy-action-2"],
    p_primary_lever_source_id: "gummy-action-1",
    p_activated_by: null,
  });
});

test("activation v2 sends the multi-metric packet to v3 and accepts more than three actions", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({
    data: [{
      activation_id: IDS.activation,
      decision_id: IDS.decision,
      prediction_id: IDS.prediction,
      action_ids: [IDS.action1, IDS.action2, IDS.action3, IDS.action4],
      primary_lever_action_id: IDS.action1,
      reused: false,
      activated_at: "2026-07-22T06:30:00.000Z",
    }],
    error: null,
  }), calls);

  const result = await materializeReportActivation(client, INPUT_V2, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.activation.actionIds.length, 4);
  assert.equal(calls[0].name, "activate_decision_report_v3");
  assert.deepEqual(calls[0].args, {
    p_report_id: INPUT_V2.reportId,
    p_revision_id: INPUT_V2.revisionId,
    p_primary_metric_id: INPUT_V2.confirmedMetricId,
    p_selected_metric_ids: INPUT_V2.selectedMetricIds,
    p_prediction_direction: INPUT_V2.prediction.direction,
    p_prediction_magnitude_pct_mean: INPUT_V2.prediction.magnitudePctMean,
    p_prediction_resolution_date: INPUT_V2.prediction.resolutionDate,
    p_selected_action_source_ids: INPUT_V2.selectedActionSourceItemIds,
    p_action_metric_assignments: INPUT_V2.actionMetricAssignments,
    p_primary_lever_source_id: INPUT_V2.primaryLeverActionSourceItemId,
    p_activated_by: null,
  });
});

test("activation metric loading uses one checked aggregate RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async () => ({
    data: [{
      metric_id: INPUT.confirmedMetricId,
      name: "Activation rate",
      source: "declared",
      unit: "percent",
      is_core: true,
      has_observations: true,
      last_observation_date: "2026-08-15",
      last_observation_value: 0.42,
      pre_history_observation_count: 90,
      pre_history_days: 90,
      readiness: "Ready to monitor",
      earliest_confident_review_date: "2026-09-30",
      percent_scale: "ratio",
    }, {
      metric_id: IDS.metric2,
      name: "Adoption rate",
      source: "csv",
      unit: "percent",
      is_core: false,
      has_observations: false,
      last_observation_date: null,
      last_observation_value: null,
      pre_history_observation_count: 0,
      pre_history_days: 0,
      readiness: "Needs data",
      earliest_confident_review_date: "2026-11-14",
      percent_scale: "points",
    }],
    error: null,
  }), calls);

  const metrics = await loadReportActivationMetrics(client, INPUT.reportId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "list_decision_report_activation_metrics_v2");
  assert.deepEqual(calls[0].args, { p_scope_id: INPUT.reportId });
  assert.deepEqual(metrics.map((metric) => [metric.metricId, metric.hasObservations]), [
    [INPUT.confirmedMetricId, true],
    [IDS.metric2, false],
  ]);
  assert.equal(metrics[0].format, "percent");
  assert.equal(metrics[0].percentScale, "ratio");
  assert.equal(metrics[0].lastObservationValue, 0.42);
  assert.equal(metrics[0].preHistoryObservationCount, 90);
  assert.equal(metrics[0].readiness, "Ready to monitor");
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
      primary_lever_action_id: IDS.action1,
      reused: false,
      activated_at: "2026-07-22T06:30:00.000Z",
    }],
    error: null,
  }), calls);

  const result = await materializeReportActivation(client, INPUT, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "database");
});

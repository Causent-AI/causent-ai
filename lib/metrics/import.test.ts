import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  importReportMetricObservations,
  importWorkspaceMetricCsv,
  loadActiveReportMetricIdentity,
  setWorkspaceCoreMetric,
} from "./import.ts";

const IDS = {
  scope: "ca5e0000-0000-0000-0000-000000000071",
  report: "ca5e0000-0000-0000-0000-000000000072",
  metric: "ca5e0000-0000-0000-0000-000000000073",
  actor: "ca5e0000-0000-0000-0000-000000000074",
  import: "ca5e0000-0000-4000-8000-000000000076",
};

const SERIES = "ca5e0000-0000-0000-0000-000000000075";

function client(response: { data: unknown; error: unknown }, calls: Array<Record<string, unknown>>): SupabaseClient {
  return { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return response; } } as unknown as SupabaseClient;
}

function sequenceClient(
  responses: Array<{ data: unknown; error: unknown }>,
  calls: Array<Record<string, unknown>>,
): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const response = responses.shift();
      if (!response) throw new Error(`missing response for ${name}`);
      return response;
    },
  } as unknown as SupabaseClient;
}

function beginRow(overrides: Record<string, unknown> = {}) {
  return {
    import_id: IDS.import,
    import_status: "received",
    metric_id: IDS.metric,
    metric_name: "Activation",
    metric_unit: "percent",
    metric_created: false,
    total_rows: 2,
    processed_rows: 0,
    inserted_rows: 0,
    updated_rows: 0,
    next_chunk_index: 0,
    start_date: "2026-07-20",
    end_date: "2026-07-21",
    reused: false,
    ...overrides,
  };
}

function selectorClient(
  responses: Array<{ data: unknown; error: unknown }>,
  calls: Array<Record<string, unknown>>,
): SupabaseClient {
  return {
    from(table: string) {
      const call: Record<string, unknown> = { table, filters: [] as unknown[] };
      calls.push(call);
      const builder = {
        select(columns: string) { call.select = columns; return builder; },
        eq(column: string, value: unknown) {
          (call.filters as unknown[]).push([column, value]);
          return builder;
        },
        async maybeSingle() {
          const response = responses.shift();
          if (!response) throw new Error("missing selector response");
          return response;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

test("active metric selection follows the explicit workspace and series pointers", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await loadActiveReportMetricIdentity(selectorClient([
    { data: { current_decision_report_series_id: SERIES }, error: null },
    { data: { current_active_report_id: IDS.report }, error: null },
    { data: {
      report_id: IDS.report,
      series_id: SERIES,
      active_metric_id: IDS.metric,
      status: "active",
      deleted_at: null,
    }, error: null },
  ], calls), IDS.scope);
  assert.deepEqual(result, { reportId: IDS.report, metricId: IDS.metric });
  assert.deepEqual(calls.map((call) => call.table), [
    "workspaces",
    "decision_report_series",
    "decision_reports",
  ]);
  assert.deepEqual(calls[2].filters, [
    ["scope_id", IDS.scope],
    ["series_id", SERIES],
    ["report_id", IDS.report],
  ]);
});

test("active metric selection never falls back to activation timestamp inference", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await loadActiveReportMetricIdentity(selectorClient([
    { data: { current_decision_report_series_id: null }, error: null },
  ], calls), IDS.scope);
  assert.equal(result, null);
  assert.equal(calls.length, 1);
});

test("repository sends a scoped receipt, idempotent chunk, and finalizer", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await importReportMetricObservations(sequenceClient([
    { data: [beginRow()], error: null },
    { data: [beginRow({
      import_status: "in_progress",
      processed_rows: 2,
      inserted_rows: 0,
      updated_rows: 0,
      next_chunk_index: 1,
    })], error: null },
    { data: [{
      ...beginRow({
        import_status: "complete",
        processed_rows: 2,
        inserted_rows: 1,
        updated_rows: 1,
      }),
      next_chunk_index: undefined,
    }], error: null },
  ], calls), {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations: [{ date: "2026-07-20", value: 1 }, { date: "2026-07-21", value: 2 }],
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.existingObservationsUpdated, true);
    assert.equal(result.summary.receipt.importId, IDS.import);
  }
  assert.deepEqual(calls.map((call) => call.name), [
    "begin_report_metric_csv_import_v2",
    "append_metric_csv_import_chunk_v2",
    "finalize_metric_csv_import_v2",
  ]);
  assert.match(String((calls[0].args as Record<string, unknown>).p_content_hash), /^[0-9a-f]{64}$/);
  assert.deepEqual((calls[1].args as Record<string, unknown>).p_observations, [
    { date: "2026-07-20", value: 1 },
    { date: "2026-07-21", value: 2 },
  ]);
});

test("invalid identities and empty packets never reach the database", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const sb = client({ data: null, error: null }, calls);
  const forged = await importReportMetricObservations(sb, {
    scopeId: IDS.scope,
    reportId: "forged",
    metricId: IDS.metric,
    observations: [{ date: "2026-07-20", value: 1 }],
    authoredBy: IDS.actor,
  });
  assert.equal(forged.ok, false);
  const empty = await importReportMetricObservations(sb, {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations: [],
    authoredBy: IDS.actor,
  });
  assert.equal(empty.ok, false);
  assert.equal(calls.length, 0);
});

test("impossible and null observation dates fail before an import receipt is opened", async () => {
  for (const date of ["2026-02-30", "2025-13-01", "0000-01-01", null]) {
    const calls: Array<Record<string, unknown>> = [];
    const result = await importReportMetricObservations(client({ data: null, error: null }, calls), {
      scopeId: IDS.scope,
      reportId: IDS.report,
      metricId: IDS.metric,
      observations: [{ date: date as string, value: 1 }],
      authoredBy: IDS.actor,
    });
    assert.equal(result.ok, false, `expected ${String(date)} to be rejected`);
    if (!result.ok) assert.equal(result.code, "validation");
    assert.equal(calls.length, 0);
  }
});

test("a nullable reused receipt flag is rejected instead of becoming a false retry", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await importReportMetricObservations(sequenceClient([
    { data: [beginRow({ reused: null })], error: null },
  ], calls), {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations: [{ date: "2026-07-20", value: 1 }, { date: "2026-07-21", value: 2 }],
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "database");
  assert.equal(calls.length, 1);
});

test("authorization failures are actionable and are not retried", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await importReportMetricObservations(client({
    data: null,
    error: { code: "42501", message: "unavailable" },
  }, calls), {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations: [{ date: "2026-07-20", value: 1 }],
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "forbidden");
  assert.equal(calls.length, 1);
});

test("expected import conflicts are typed and never retried", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await importReportMetricObservations(client({
    data: null,
    error: { code: "C4090", message: "Retry the exact file already in progress." },
  }, calls), {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations: [{ date: "2026-07-20", value: 1 }],
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "conflict");
    assert.equal(result.error, "Retry the exact file already in progress.");
  }
  assert.equal(calls.length, 1);
});

test("workspace metric import uses the resumable receipt contract", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const workspaceBegin = beginRow({
    metric_name: "AI assistant adoption rate",
    metric_created: true,
  });
  const result = await importWorkspaceMetricCsv(sequenceClient([
    { data: [workspaceBegin], error: null },
    { data: [beginRow({
      metric_name: "AI assistant adoption rate",
      metric_created: true,
      import_status: "in_progress",
      processed_rows: 2,
      inserted_rows: 0,
      next_chunk_index: 1,
    })], error: null },
    { data: [{
      import_id: IDS.import,
      import_status: "complete",
      metric_id: IDS.metric,
      metric_name: "AI assistant adoption rate",
      metric_unit: "percent",
      metric_created: true,
      total_rows: 2,
      processed_rows: 2,
      inserted_rows: 2,
      updated_rows: 0,
      start_date: "2026-07-20",
      end_date: "2026-07-21",
      reused: false,
    }], error: null },
  ], calls), {
    scopeId: IDS.scope,
    name: "AI assistant adoption rate",
    unit: "percent",
    observations: [{ date: "2026-07-20", value: 0.4 }, { date: "2026-07-21", value: 0.41 }],
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.created, true);
    assert.equal(result.summary.metricUnit, "percent");
  }
  assert.deepEqual(calls.map((call) => call.name), [
    "begin_workspace_metric_csv_import_v2",
    "append_metric_csv_import_chunk_v2",
    "finalize_metric_csv_import_v2",
  ]);
});

test("workspace metric import rejects invalid catalog inputs before the RPC", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const sb = client({ data: null, error: null }, calls);
  const invalidName = await importWorkspaceMetricCsv(sb, {
    scopeId: IDS.scope,
    name: "\u0000",
    unit: "count",
    observations: [{ date: "2026-07-20", value: 1 }],
    authoredBy: IDS.actor,
  });
  assert.equal(invalidName.ok, false);
  const invalidUnit = await importWorkspaceMetricCsv(sb, {
    scopeId: IDS.scope,
    name: "Visits",
    unit: "bogus" as never,
    observations: [{ date: "2026-07-20", value: 1 }],
    authoredBy: IDS.actor,
  });
  assert.equal(invalidUnit.ok, false);
  assert.equal(calls.length, 0);
});

test("serialization victims retry with the same receipt and large packets use deterministic chunks", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const observations = Array.from({ length: 251 }, (_, index) => {
    const next = new Date(Date.UTC(2025, 0, 1 + index));
    return { date: next.toISOString().slice(0, 10), value: index };
  });
  const endDate = observations.at(-1)!.date;
  const startDate = observations[0].date;
  const largeBegin = beginRow({ total_rows: 251, start_date: startDate, end_date: endDate });
  const result = await importReportMetricObservations(sequenceClient([
    { data: null, error: { code: "40001", message: "serialization victim" } },
    { data: [largeBegin], error: null },
    { data: [beginRow({
      import_status: "in_progress",
      total_rows: 251,
      processed_rows: 250,
      inserted_rows: 0,
      next_chunk_index: 1,
      start_date: startDate,
      end_date: endDate,
    })], error: null },
    { data: [beginRow({
      import_status: "in_progress",
      total_rows: 251,
      processed_rows: 251,
      inserted_rows: 0,
      next_chunk_index: 2,
      start_date: startDate,
      end_date: endDate,
    })], error: null },
    { data: [{
      import_id: IDS.import,
      import_status: "complete",
      metric_id: IDS.metric,
      metric_name: "Activation",
      metric_unit: null,
      metric_created: false,
      total_rows: 251,
      processed_rows: 251,
      inserted_rows: 251,
      updated_rows: 0,
      start_date: startDate,
      end_date: endDate,
      reused: false,
    }], error: null },
  ], calls), {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations,
    authoredBy: IDS.actor,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.name), [
    "begin_report_metric_csv_import_v2",
    "begin_report_metric_csv_import_v2",
    "append_metric_csv_import_chunk_v2",
    "append_metric_csv_import_chunk_v2",
    "finalize_metric_csv_import_v2",
  ]);
  assert.deepEqual(calls[0].args, calls[1].args);
  assert.equal(((calls[2].args as Record<string, unknown>).p_observations as unknown[]).length, 250);
  assert.equal(((calls[3].args as Record<string, unknown>).p_observations as unknown[]).length, 1);
});

test("core metric selection sends one scoped RPC and maps the selection count", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await setWorkspaceCoreMetric(client({
    data: [{ selected_metric_id: IDS.metric, is_core: true, core_metric_count: 2 }],
    error: null,
  }, calls), {
    scopeId: IDS.scope,
    metricId: IDS.metric,
    isCore: true,
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.metricId, IDS.metric);
    assert.equal(result.coreMetricCount, 2);
  }
  assert.deepEqual(calls, [{
    name: "set_workspace_core_metric_v1",
    args: {
      p_scope_id: IDS.scope,
      p_metric_id: IDS.metric,
      p_is_core: true,
      p_authored_by: IDS.actor,
    },
  }]);
});

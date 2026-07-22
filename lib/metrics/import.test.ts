import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importReportMetricObservations } from "./import.ts";

const IDS = {
  scope: "ca5e0000-0000-0000-0000-000000000071",
  report: "ca5e0000-0000-0000-0000-000000000072",
  metric: "ca5e0000-0000-0000-0000-000000000073",
  actor: "ca5e0000-0000-0000-0000-000000000074",
};

function client(response: { data: unknown; error: unknown }, calls: Array<Record<string, unknown>>): SupabaseClient {
  return { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return response; } } as unknown as SupabaseClient;
}

test("repository sends one scope/report/metric-bound RPC and maps its update summary", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await importReportMetricObservations(client({
    data: [{
      metric_id: IDS.metric,
      metric_name: "Activation",
      accepted_rows: 2,
      inserted_rows: 1,
      updated_rows: 1,
      start_date: "2026-07-20",
      end_date: "2026-07-21",
    }],
    error: null,
  }, calls), {
    scopeId: IDS.scope,
    reportId: IDS.report,
    metricId: IDS.metric,
    observations: [{ date: "2026-07-20", value: 1 }, { date: "2026-07-21", value: 2 }],
    authoredBy: IDS.actor,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.summary.existingObservationsUpdated, true);
  assert.deepEqual(calls, [{
    name: "import_active_report_metric_csv_v1",
    args: {
      p_scope_id: IDS.scope,
      p_report_id: IDS.report,
      p_metric_id: IDS.metric,
      p_observations: [{ date: "2026-07-20", value: 1 }, { date: "2026-07-21", value: 2 }],
      p_authored_by: IDS.actor,
    },
  }]);
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

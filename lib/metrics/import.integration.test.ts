import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "../decision-reports/fixtures/gummy-alpha.ts";
import { materializeReportActivation } from "../decision-reports/materialization.ts";
import { saveDecisionReport } from "../decision-reports/persistence.ts";
import { importReportMetricObservations } from "./import.ts";

function localEnv(): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n").flatMap((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      return match && !line.trim().startsWith("#") ? [[match[1], match[2]]] : [];
    }));
  } catch { return {}; }
}

const env = localEnv();
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const ORG = randomUUID();
const PROJECT = randomUUID();
const WORKSPACE = randomUUID();
const OTHER_WORKSPACE = randomUUID();
const METRIC = randomUUID();
const OTHER_METRIC = randomUUID();
let sb: SupabaseClient | null = null;
let available = false;
let reportId = "";

async function teardown(client: SupabaseClient) { await client.from("orgs").delete().eq("org_id", ORG); }

before(async () => {
  if (!URL || !KEY) return;
  sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = await sb.rpc("import_active_report_metric_csv_v1", {
    p_scope_id: WORKSPACE,
    p_report_id: randomUUID(),
    p_metric_id: METRIC,
    p_observations: [{ date: "2026-07-20", value: 1 }],
    p_authored_by: null,
  }).then((result) => result, () => ({ error: { code: "unreachable" } }));
  if (probe.error && !["42501", "22023", "P0002"].includes(probe.error.code ?? "")) return;
  available = true;
  await teardown(sb);
  assert.equal((await sb.from("orgs").insert({ org_id: ORG, name: "METRIC_IMPORT_TEST" })).error, null);
  assert.equal((await sb.from("projects").insert({ project_id: PROJECT, org_id: ORG, name: "p" })).error, null);
  assert.equal((await sb.from("workspaces").insert([
    { workspace_id: WORKSPACE, project_id: PROJECT, name: "w" },
    { workspace_id: OTHER_WORKSPACE, project_id: PROJECT, name: "other" },
  ])).error, null);
  assert.equal((await sb.from("metrics").insert([
    { metric_id: METRIC, scope_id: WORKSPACE, name: "Activation Rate", source: "declared", granularity: "daily" },
    { metric_id: OTHER_METRIC, scope_id: OTHER_WORKSPACE, name: "Foreign Metric", source: "declared", granularity: "daily" },
  ])).error, null);
  const saved = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  reportId = saved.saved.reportId;
  const activated = await materializeReportActivation(sb, {
    schemaVersion: 1,
    reportId,
    revisionId: saved.saved.revisionId,
    confirmedMetricId: METRIC,
    prediction: { direction: "POSITIVE", magnitudePctMean: 5, resolutionDate: "2027-01-15" },
    selectedActionSourceItemIds: [GUMMY_ALPHA_GOLDEN_EXAMPLE.report.implementation.actions[0].sourceItemId],
  }, null);
  assert.equal(activated.ok, true, activated.ok ? undefined : activated.error);
});

after(async () => { if (sb && available) await teardown(sb); });

function gated(t: TestContext): boolean {
  if (!available || !sb || !reportId) { t.skip("Slice 7 migration/local Supabase unavailable"); return false; }
  return true;
}

test("imports atomically and retries idempotently without duplicating observations", async (t) => {
  if (!gated(t) || !sb) return;
  const first = await importReportMetricObservations(sb, {
    scopeId: WORKSPACE, reportId, metricId: METRIC, authoredBy: null,
    observations: [{ date: "2026-07-20", value: 10 }, { date: "2026-07-21", value: 11 }],
  });
  assert.equal(first.ok, true, first.ok ? undefined : first.error);
  if (!first.ok) return;
  assert.deepEqual({ inserted: first.summary.insertedRows, updated: first.summary.updatedRows }, { inserted: 2, updated: 0 });

  const retry = await importReportMetricObservations(sb, {
    scopeId: WORKSPACE, reportId, metricId: METRIC, authoredBy: null,
    observations: [{ date: "2026-07-20", value: 10 }, { date: "2026-07-21", value: 12 }],
  });
  assert.equal(retry.ok, true, retry.ok ? undefined : retry.error);
  if (!retry.ok) return;
  assert.deepEqual({ inserted: retry.summary.insertedRows, updated: retry.summary.updatedRows }, { inserted: 0, updated: 2 });
  const rows = await sb.from("metric_observations").select("obs_date,value").eq("metric_id", METRIC).order("obs_date");
  assert.equal(rows.data?.length, 2);
  assert.equal(Number(rows.data?.[1].value), 12);
  const metric = await sb.from("metrics").select("source").eq("metric_id", METRIC).single();
  assert.equal(metric.data?.source, "csv");
});

test("rejects forged report, metric, and cross-workspace combinations with no foreign write", async (t) => {
  if (!gated(t) || !sb) return;
  for (const target of [
    { scopeId: WORKSPACE, reportId: randomUUID(), metricId: METRIC },
    { scopeId: WORKSPACE, reportId, metricId: OTHER_METRIC },
    { scopeId: OTHER_WORKSPACE, reportId, metricId: OTHER_METRIC },
  ]) {
    const result = await importReportMetricObservations(sb, {
      ...target,
      authoredBy: null,
      observations: [{ date: "2026-07-22", value: 99 }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "forbidden");
  }
  const foreign = await sb.from("metric_observations").select("obs_date").eq("metric_id", OTHER_METRIC);
  assert.equal(foreign.data?.length, 0);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import type { ReportActivationInputV1 } from "./activation.ts";
import { materializeReportActivation } from "./materialization.ts";
import { loadDecisionReport, saveDecisionReport } from "./persistence.ts";

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !line.trim().startsWith("#")) out[match[1]] = match[2];
    }
    return out;
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? ""
).trim();

const ORG = randomUUID();
const PROJECT = randomUUID();
const WORKSPACE = randomUUID();
const OTHER_WORKSPACE = randomUUID();
const METRIC = randomUUID();
const OTHER_METRIC = randomUUID();

let sb: SupabaseClient | null = null;
let available = false;

async function teardown(client: SupabaseClient) {
  await client.from("orgs").delete().eq("org_id", ORG);
}

before(async () => {
  if (!URL || !KEY) return;
  sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = await sb
    .from("decision_report_activations")
    .select("activation_id")
    .limit(1)
    .then((result) => result, () => ({ error: new Error("unreachable") }));
  if (probe.error) return;

  available = true;
  await teardown(sb);
  assert.equal((await sb.from("orgs").insert({ org_id: ORG, name: "ACTIVATION_TEST_org" })).error, null);
  assert.equal((await sb.from("projects").insert({
    project_id: PROJECT,
    org_id: ORG,
    name: "Orbit",
  })).error, null);
  assert.equal((await sb.from("workspaces").insert([
    { workspace_id: WORKSPACE, project_id: PROJECT, name: "Gummy Alpha" },
    { workspace_id: OTHER_WORKSPACE, project_id: PROJECT, name: "Other" },
  ])).error, null);
  assert.equal((await sb.from("metrics").insert([
    {
      metric_id: METRIC,
      scope_id: WORKSPACE,
      name: "Flavor-combination step completion rate",
      source: "declared",
      unit: "percent",
    },
    {
      metric_id: OTHER_METRIC,
      scope_id: OTHER_WORKSPACE,
      name: "Wrong workspace metric",
      source: "declared",
      unit: "percent",
    },
  ])).error, null);
});

after(async () => {
  if (sb && available) await teardown(sb);
});

function gated(t: TestContext): boolean {
  if (!available) {
    t.skip("Decision Report activation migration is unavailable — start local Supabase");
    return false;
  }
  return true;
}

test("activation atomically materializes once, reuses retries, and locks the report", async (t) => {
  if (!gated(t) || !sb) return;

  const saved = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(saved.ok, true, saved.ok ? undefined : saved.error);
  if (!saved.ok) return;

  const input: ReportActivationInputV1 = {
    schemaVersion: 1,
    reportId: saved.saved.reportId,
    revisionId: saved.saved.revisionId,
    confirmedMetricId: METRIC,
    prediction: {
      direction: "POSITIVE" as const,
      magnitudePctMean: 15,
      resolutionDate: "2026-12-15",
    },
    selectedActionSourceItemIds: ["gummy-action-1", "gummy-action-3"],
  };

  const first = await materializeReportActivation(sb, input, null);
  assert.equal(first.ok, true, first.ok ? undefined : first.error);
  if (!first.ok) return;
  assert.equal(first.activation.reused, false);
  assert.equal(first.activation.actionIds.length, 2);

  const retry = await materializeReportActivation(sb, {
    ...input,
    selectedActionSourceItemIds: [...input.selectedActionSourceItemIds].reverse(),
  }, null);
  assert.equal(retry.ok, true, retry.ok ? undefined : retry.error);
  if (!retry.ok) return;
  assert.equal(retry.activation.reused, true);
  assert.deepEqual(retry.activation, { ...first.activation, reused: true });

  const changedRetry = await materializeReportActivation(sb, {
    ...input,
    prediction: { ...input.prediction, magnitudePctMean: 20 },
  }, null);
  assert.equal(changedRetry.ok, false);
  if (!changedRetry.ok) {
    assert.equal(changedRetry.code, "conflict");
    assert.equal(changedRetry.activationId, first.activation.activationId);
  }

  const report = await sb
    .from("decision_reports")
    .select(
      "status, current_revision_id, reviewed_revision_id, active_activation_id, " +
        "active_decision_id, active_prediction_id, active_metric_id, activated_at",
    )
    .eq("report_id", saved.saved.reportId)
    .single();
  assert.equal(report.error, null, report.error?.message);
  const reportRow = report.data as unknown as {
    status: string;
    current_revision_id: string;
    reviewed_revision_id: string;
    active_activation_id: string;
    active_decision_id: string;
    active_prediction_id: string;
    active_metric_id: string;
  };
  assert.equal(reportRow.status, "active");
  assert.equal(reportRow.current_revision_id, saved.saved.revisionId);
  assert.equal(reportRow.reviewed_revision_id, saved.saved.revisionId);
  assert.equal(reportRow.active_activation_id, first.activation.activationId);
  assert.equal(reportRow.active_decision_id, first.activation.decisionId);
  assert.equal(reportRow.active_prediction_id, first.activation.predictionId);
  assert.equal(reportRow.active_metric_id, METRIC);

  const decision = await sb
    .from("decisions")
    .select("decision_id, title, rationale")
    .eq("decision_id", first.activation.decisionId)
    .single();
  assert.equal(decision.error, null, decision.error?.message);
  assert.equal(decision.data?.title, GUMMY_ALPHA_GOLDEN_EXAMPLE.report.title);
  assert.equal(decision.data?.rationale?.meta?.source, "decision_report");

  const prediction = await sb
    .from("predictions")
    .select("prediction_id, decision_id, metric_id, direction, magnitude_pct_mean, resolution_date")
    .eq("prediction_id", first.activation.predictionId)
    .single();
  assert.equal(prediction.error, null, prediction.error?.message);
  assert.deepEqual(
    {
      decisionId: prediction.data?.decision_id,
      metricId: prediction.data?.metric_id,
      direction: prediction.data?.direction,
      magnitude: prediction.data?.magnitude_pct_mean,
      resolutionDate: prediction.data?.resolution_date,
    },
    {
      decisionId: first.activation.decisionId,
      metricId: METRIC,
      direction: "POSITIVE",
      magnitude: 15,
      resolutionDate: "2026-12-15",
    },
  );

  const actions = await sb
    .from("actions")
    .select("action_id, source, external_ref, status, ship_ts, effective_date, rationale_richtext")
    .in("action_id", first.activation.actionIds)
    .order("external_ref");
  assert.equal(actions.error, null, actions.error?.message);
  assert.equal(actions.data?.length, 2);
  assert.deepEqual(new Set(actions.data?.map((row) => row.source)), new Set(["manual"]));
  assert.deepEqual(new Set(actions.data?.map((row) => row.status)), new Set(["planned"]));
  assert.deepEqual(new Set(actions.data?.map((row) => row.ship_ts)), new Set([null]));
  assert.deepEqual(new Set(actions.data?.map((row) => row.effective_date)), new Set([null]));
  assert.deepEqual(
    new Set(actions.data?.map((row) => row.rationale_richtext?.meta?.source_item_id)),
    new Set(["gummy-action-1", "gummy-action-3"]),
  );

  const links = await sb
    .from("decision_actions")
    .select("action_id")
    .eq("decision_id", first.activation.decisionId);
  assert.equal(links.error, null, links.error?.message);
  assert.deepEqual(
    new Set(links.data?.map((row) => row.action_id)),
    new Set(first.activation.actionIds),
  );

  const canonicalCounts = await Promise.all([
    sb.from("decision_report_activations").select("*", { count: "exact", head: true }).eq("report_id", saved.saved.reportId),
    sb.from("decisions").select("*", { count: "exact", head: true }).eq("decision_id", first.activation.decisionId),
    sb.from("predictions").select("*", { count: "exact", head: true }).eq("decision_id", first.activation.decisionId),
    sb.from("actions").select("*", { count: "exact", head: true }).in("action_id", first.activation.actionIds),
    sb.from("levers").select("*", { count: "exact", head: true }).eq("decision_id", first.activation.decisionId),
  ]);
  assert.deepEqual(canonicalCounts.map((result) => result.count), [1, 1, 1, 2, 0]);

  const loaded = await loadDecisionReport(sb, WORKSPACE, saved.saved.reportId);
  assert.equal(loaded.ok, true, loaded.ok ? undefined : loaded.error);
  if (loaded.ok) {
    assert.equal(loaded.saved.status, "active");
    assert.equal(loaded.saved.activation?.decisionId, first.activation.decisionId);
  }

  const editAfterActivation = await saveDecisionReport(sb, WORKSPACE, {
    reportId: saved.saved.reportId,
    baseRevisionId: saved.saved.revisionId,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(editAfterActivation.ok, false);
  if (!editAfterActivation.ok) assert.equal(editAfterActivation.code, "conflict");
});

test("invalid selections and cross-workspace metrics roll back without canonical writes", async (t) => {
  if (!gated(t) || !sb) return;
  const saved = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(saved.ok, true, saved.ok ? undefined : saved.error);
  if (!saved.ok) return;

  const base = {
    schemaVersion: 1 as const,
    reportId: saved.saved.reportId,
    revisionId: saved.saved.revisionId,
    confirmedMetricId: METRIC,
    prediction: {
      direction: "POSITIVE" as const,
      magnitudePctMean: 15,
      resolutionDate: "2026-12-15",
    },
    selectedActionSourceItemIds: ["forged-action-id"],
  };
  const forged = await materializeReportActivation(sb, base, null);
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.code, "validation");

  const otherMetric = await materializeReportActivation(sb, {
    ...base,
    confirmedMetricId: OTHER_METRIC,
    selectedActionSourceItemIds: ["gummy-action-1"],
  }, null);
  assert.equal(otherMetric.ok, false);
  if (!otherMetric.ok) assert.equal(otherMetric.code, "forbidden");

  const counts = await Promise.all([
    sb.from("decision_report_activations").select("*", { count: "exact", head: true }).eq("report_id", saved.saved.reportId),
    sb.from("decisions").select("*", { count: "exact", head: true }).eq("scope_id", WORKSPACE),
  ]);
  assert.equal(counts[0].count, 0);
  // The first test creates one decision in this workspace; neither invalid call adds another.
  assert.equal(counts[1].count, 1);
});

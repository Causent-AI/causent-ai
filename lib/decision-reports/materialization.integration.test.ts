import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import type {
  ReportActivationInputV1,
  ReportActivationInputV2,
} from "./activation.ts";
import {
  authorizeReportActivationTarget,
  loadReportActivationMetrics,
  materializeReportActivation,
  resolveActivatedReportAction,
} from "./materialization.ts";
import { loadDecisionReport, saveDecisionReport } from "./persistence.ts";

type QueryError = { message: string } | null;

type QueryResult<T> = {
  data: T;
  error: QueryError;
};

type ActivationActionMetricAuditRow = {
  action_id: string;
  action_source_item_id: string;
  metric_id: string;
  monitoring_expected_direction: "INCREASE" | "DECREASE" | null;
  monitoring_check_date: string | null;
};

type PackageInterventionAuditRow = {
  causal_object: "decision_package";
  intervention_rule: "latest_effective_included_action";
  registered_primary_action_id: string;
  intervention_action_id: string;
  intervention_date: string;
  included_action_ids: string[];
  package_hash: string;
};

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
const ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
).trim();

const ORG = randomUUID();
const PROJECT = randomUUID();
const OTHER_ORG = randomUUID();
const OTHER_PROJECT = randomUUID();
const WORKSPACE = randomUUID();
const OTHER_WORKSPACE = randomUUID();
const METRIC = randomUUID();
const SECONDARY_METRIC = randomUUID();
const OTHER_METRIC = randomUUID();

let sb: SupabaseClient | null = null;
let memberSb: SupabaseClient | null = null;
let viewerSb: SupabaseClient | null = null;
let memberUserId: string | null = null;
let viewerUserId: string | null = null;
let available = false;
const MEMBER_EMAIL = `activation-member-${randomUUID()}@example.test`;
const VIEWER_EMAIL = `activation-viewer-${randomUUID()}@example.test`;
const AUTH_PASSWORD = `Causent-${randomUUID()}-A1!`;

async function teardown(client: SupabaseClient) {
  await client.from("orgs").delete().in("org_id", [ORG, OTHER_ORG]);
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
  assert.equal((await sb.from("orgs").insert([
    { org_id: ORG, name: "ACTIVATION_TEST_org" },
    { org_id: OTHER_ORG, name: "ACTIVATION_TEST_other_org" },
  ])).error, null);
  assert.equal((await sb.from("projects").insert([
    { project_id: PROJECT, org_id: ORG, name: "Orbit" },
    { project_id: OTHER_PROJECT, org_id: OTHER_ORG, name: "Other project" },
  ])).error, null);
  assert.equal((await sb.from("workspaces").insert([
    { workspace_id: WORKSPACE, project_id: PROJECT, name: "Gummy Alpha" },
    { workspace_id: OTHER_WORKSPACE, project_id: OTHER_PROJECT, name: "Other" },
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
    {
      metric_id: SECONDARY_METRIC,
      scope_id: WORKSPACE,
      name: "Assistant adoption rate",
      source: "declared",
      unit: "percent",
    },
  ])).error, null);

  if (ANON_KEY) {
    const [memberUser, viewerUser] = await Promise.all([
      sb.auth.admin.createUser({
        email: MEMBER_EMAIL,
        password: AUTH_PASSWORD,
        email_confirm: true,
      }),
      sb.auth.admin.createUser({
        email: VIEWER_EMAIL,
        password: AUTH_PASSWORD,
        email_confirm: true,
      }),
    ]);
    assert.equal(memberUser.error, null, memberUser.error?.message);
    assert.equal(viewerUser.error, null, viewerUser.error?.message);
    memberUserId = memberUser.data.user?.id ?? null;
    viewerUserId = viewerUser.data.user?.id ?? null;
    assert.ok(memberUserId);
    assert.ok(viewerUserId);
    const memberships = await sb.from("memberships").insert([
      { user_id: memberUserId, org_id: ORG, role: "member" },
      { user_id: viewerUserId, org_id: ORG, role: "viewer" },
    ]);
    assert.equal(memberships.error, null, memberships.error?.message);

    memberSb = createClient(URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    viewerSb = createClient(URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [memberSession, viewerSession] = await Promise.all([
      memberSb.auth.signInWithPassword({ email: MEMBER_EMAIL, password: AUTH_PASSWORD }),
      viewerSb.auth.signInWithPassword({ email: VIEWER_EMAIL, password: AUTH_PASSWORD }),
    ]);
    assert.equal(memberSession.error, null, memberSession.error?.message);
    assert.equal(viewerSession.error, null, viewerSession.error?.message);
  }
});

after(async () => {
  if (sb && available) await teardown(sb);
  if (sb && memberUserId) await sb.auth.admin.deleteUser(memberUserId);
  if (sb && viewerUserId) await sb.auth.admin.deleteUser(viewerUserId);
});

function gated(t: TestContext): boolean {
  if (!available) {
    t.skip("Decision Report activation migration is unavailable — start local Supabase");
    return false;
  }
  return true;
}

function authenticatedGated(t: TestContext): boolean {
  if (!gated(t)) return false;
  if (!sb || !memberSb || !viewerSb || !memberUserId || !viewerUserId) {
    t.skip("Authenticated activation fixture is unavailable");
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
      resolutionDate: "2099-12-15",
    },
    selectedActionSourceItemIds: ["gummy-action-1", "gummy-action-3"],
    primaryLeverActionSourceItemId: "gummy-action-1",
  };

  const first = await materializeReportActivation(sb, input, null);
  assert.equal(first.ok, true, first.ok ? undefined : first.error);
  if (!first.ok) return;
  assert.equal(first.activation.reused, false);
  assert.equal(first.activation.actionIds.length, 2);
  assert.ok(first.activation.actionIds.includes(first.activation.primaryLeverActionId));

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

  const changedPrimaryLever = await materializeReportActivation(sb, {
    ...input,
    primaryLeverActionSourceItemId: "gummy-action-3",
  }, null);
  assert.equal(changedPrimaryLever.ok, false);
  if (!changedPrimaryLever.ok) {
    assert.equal(changedPrimaryLever.code, "conflict");
    assert.equal(changedPrimaryLever.activationId, first.activation.activationId);
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
      resolutionDate: "2099-12-15",
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
    sb.from("decision_report_activation_metrics").select("*", { count: "exact", head: true }).eq("activation_id", first.activation.activationId),
    sb.from("decision_report_activation_action_metrics").select("*", { count: "exact", head: true }).eq("activation_id", first.activation.activationId),
  ]);
  assert.deepEqual(canonicalCounts.map((result) => result.count), [1, 1, 1, 2, 1, 1, 2]);

  const primaryLever = await sb
    .from("levers")
    .select("action_id, metric_id, target_source, status")
    .eq("decision_id", first.activation.decisionId)
    .single();
  assert.equal(primaryLever.error, null, primaryLever.error?.message);
  assert.equal(primaryLever.data?.action_id, first.activation.primaryLeverActionId);
  assert.equal(primaryLever.data?.metric_id, METRIC);
  assert.equal(primaryLever.data?.target_source, "manual");
  assert.equal(primaryLever.data?.status, "DRAFTED");

  const loaded = await loadDecisionReport(sb, WORKSPACE, saved.saved.reportId);
  assert.equal(loaded.ok, true, loaded.ok ? undefined : loaded.error);
  if (loaded.ok) {
    assert.equal(loaded.saved.status, "active");
    assert.equal(loaded.saved.activation?.decisionId, first.activation.decisionId);
    assert.deepEqual(loaded.saved.activation?.selectedMetricIds, [METRIC]);
    assert.deepEqual(
      new Set(loaded.saved.activation?.selectedActionSourceItemIds),
      new Set(input.selectedActionSourceItemIds),
    );
    assert.equal(
      loaded.saved.activation?.primaryLeverActionSourceItemId,
      input.primaryLeverActionSourceItemId,
    );
    assert.deepEqual(
      new Set(loaded.saved.activation?.actionBindings.map((binding) => binding.actionId)),
      new Set(first.activation.actionIds),
    );
    assert.equal(
      loaded.saved.activation?.actionBindings.find(
        (binding) => binding.actionSourceItemId === input.primaryLeverActionSourceItemId,
      )?.actionId,
      first.activation.primaryLeverActionId,
    );
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

test("activation v2 uses latest effective package timing across reverse-order and tied completions", async (t) => {
  if (!gated(t) || !sb) return;

  const report = structuredClone(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.actions.push({
    ...structuredClone(report.implementation.actions[2]),
    sourceItemId: "gummy-action-4",
    title: "Roll out the validated assistant",
    summary: [{
      id: "gummy-action-4-summary",
      text: "Roll the winning experience out and monitor adoption after launch.",
      status: "suggested",
      sourceChunkIds: [],
    }],
  });
  report.implementation.actions[0].monitoringExpectedDirection = "INCREASE";
  report.implementation.actions[0].monitoringCheckDate = "2026-09-15";
  report.implementation.actions[1].monitoringExpectedDirection = "DECREASE";
  report.implementation.actions[1].monitoringCheckDate = "2026-09-30";

  const saved = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(saved.ok, true, saved.ok ? undefined : saved.error);
  if (!saved.ok) return;

  const input: ReportActivationInputV2 = {
    schemaVersion: 2,
    reportId: saved.saved.reportId,
    revisionId: saved.saved.revisionId,
    confirmedMetricId: METRIC,
    selectedMetricIds: [METRIC, SECONDARY_METRIC],
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: 18,
      resolutionDate: "2099-12-15",
    },
    selectedActionSourceItemIds: [
      "gummy-action-1",
      "gummy-action-2",
      "gummy-action-3",
      "gummy-action-4",
    ],
    actionMetricAssignments: [
      { actionSourceItemId: "gummy-action-1", metricId: METRIC },
      { actionSourceItemId: "gummy-action-2", metricId: SECONDARY_METRIC },
      { actionSourceItemId: "gummy-action-3", metricId: SECONDARY_METRIC },
      { actionSourceItemId: "gummy-action-4", metricId: METRIC },
    ],
    primaryLeverActionSourceItemId: "gummy-action-1",
  };

  const first = await materializeReportActivation(sb, input, null);
  assert.equal(first.ok, true, first.ok ? undefined : first.error);
  if (!first.ok) return;
  assert.equal(first.activation.reused, false);
  assert.equal(first.activation.actionIds.length, 4);

  const startedFromSupportAction = await resolveActivatedReportAction(sb, {
    scopeId: WORKSPACE,
    activationId: first.activation.activationId,
    actionSourceItemId: "gummy-action-2",
    expectedActionIds: first.activation.actionIds,
  });
  assert.equal(
    startedFromSupportAction.ok,
    true,
    startedFromSupportAction.ok ? undefined : startedFromSupportAction.error,
  );
  if (startedFromSupportAction.ok) {
    assert.notEqual(
      startedFromSupportAction.actionId,
      first.activation.primaryLeverActionId,
    );
  }

  const startedFromPrimaryAction = await resolveActivatedReportAction(sb, {
    scopeId: WORKSPACE,
    activationId: first.activation.activationId,
    actionSourceItemId: "gummy-action-1",
    expectedActionIds: first.activation.actionIds,
  });
  assert.deepEqual(startedFromPrimaryAction, {
    ok: true,
    actionId: first.activation.primaryLeverActionId,
  });

  const retry = await materializeReportActivation(sb, {
    ...input,
    selectedMetricIds: [...input.selectedMetricIds].reverse(),
    selectedActionSourceItemIds: [...input.selectedActionSourceItemIds].reverse(),
    actionMetricAssignments: [...input.actionMetricAssignments].reverse(),
  }, null);
  assert.equal(retry.ok, true, retry.ok ? undefined : retry.error);
  if (retry.ok) {
    assert.equal(retry.activation.reused, true);
    assert.equal(retry.activation.activationId, first.activation.activationId);
    assert.deepEqual(retry.activation.actionIds, first.activation.actionIds);
  }

  const changedMapping = await materializeReportActivation(sb, {
    ...input,
    actionMetricAssignments: input.actionMetricAssignments.map((assignment) =>
      assignment.actionSourceItemId === "gummy-action-4"
        ? { ...assignment, metricId: SECONDARY_METRIC }
        : assignment
    ),
  }, null);
  assert.equal(changedMapping.ok, false);
  if (!changedMapping.ok) {
    assert.equal(changedMapping.code, "conflict");
    assert.equal(changedMapping.activationId, first.activation.activationId);
  }

  const [activation, selectedMetrics, bindings, actions, canonicalCounts, reportState, workspace] =
    await Promise.all([
      sb.from("decision_report_activations")
        .select("activation_id, contract_version, metric_id, primary_lever_action_id")
        .eq("activation_id", first.activation.activationId)
        .single(),
      sb.from("decision_report_activation_metrics")
        .select("metric_id")
        .eq("activation_id", first.activation.activationId),
      sb.from("decision_report_activation_action_metrics")
        .select(
          "action_id, action_source_item_id, metric_id, " +
            "monitoring_expected_direction, monitoring_check_date",
        )
        .eq("activation_id", first.activation.activationId),
      sb.from("actions")
        .select("action_id, rationale_richtext")
        .in("action_id", first.activation.actionIds),
      Promise.all([
        sb.from("predictions").select("*", { count: "exact", head: true })
          .eq("decision_id", first.activation.decisionId),
        sb.from("levers").select("*", { count: "exact", head: true })
          .eq("decision_id", first.activation.decisionId),
      ]),
      sb.from("decision_reports")
        .select("series_id")
        .eq("report_id", saved.saved.reportId)
        .single(),
      sb.from("workspaces")
        .select("current_decision_report_series_id")
        .eq("workspace_id", WORKSPACE)
        .single(),
    ]);

  for (const result of [activation, selectedMetrics, bindings, actions, reportState, workspace]) {
    assert.equal(result.error, null, result.error?.message);
  }
  const series = await sb.from("decision_report_series")
    .select("series_id, current_active_report_id")
    .eq("series_id", reportState.data?.series_id ?? "")
    .single();
  assert.equal(series.error, null, series.error?.message);
  assert.equal(activation.data?.contract_version, 2);
  assert.equal(activation.data?.metric_id, METRIC);
  assert.equal(activation.data?.primary_lever_action_id, first.activation.primaryLeverActionId);
  const bindingRows = (bindings.data ?? []) as unknown as ActivationActionMetricAuditRow[];
  assert.deepEqual(
    new Set(selectedMetrics.data?.map((row) => row.metric_id)),
    new Set([METRIC, SECONDARY_METRIC]),
  );
  const monitoredBinding = bindingRows.find(
    (row) => row.action_source_item_id === "gummy-action-2",
  );
  const primaryBinding = bindingRows.find(
    (row) => row.action_source_item_id === "gummy-action-1",
  );
  assert.equal(primaryBinding?.monitoring_expected_direction, null);
  assert.equal(primaryBinding?.monitoring_check_date, null);
  assert.equal(monitoredBinding?.monitoring_expected_direction, "DECREASE");
  assert.equal(monitoredBinding?.monitoring_check_date, "2026-09-30");
  assert.equal(bindingRows.length, 4);
  assert.deepEqual(
    new Map(bindingRows.map((row) => [row.action_source_item_id, row.metric_id])),
    new Map(input.actionMetricAssignments.map((row) => [row.actionSourceItemId, row.metricId])),
  );

  const expectedMetricNames = new Map<string, string>([
    [METRIC, "Flavor-combination step completion rate"],
    [SECONDARY_METRIC, "Assistant adoption rate"],
  ]);
  const metricByActionId = new Map(bindingRows.map((row) => [row.action_id, row.metric_id]));
  for (const action of actions.data ?? []) {
    assert.equal(
      action.rationale_richtext?.meta?.expected_metric,
      expectedMetricNames.get(metricByActionId.get(action.action_id) ?? ""),
    );
  }
  assert.deepEqual(canonicalCounts.map((result) => result.count), [1, 1]);
  assert.equal(series.data?.current_active_report_id, saved.saved.reportId);
  assert.equal(workspace.data?.current_decision_report_series_id, reportState.data?.series_id);

  const actionIdBySource = new Map(
    bindingRows.map((row) => [row.action_source_item_id, row.action_id]),
  );
  const partialCompletions = [
    { sourceItemId: "gummy-action-4", completedOn: "2026-08-14" },
    { sourceItemId: "gummy-action-2", completedOn: "2026-08-14" },
    { sourceItemId: "gummy-action-1", completedOn: "2026-08-13" },
  ];
  for (const [index, partialCompletion] of partialCompletions.entries()) {
    const { sourceItemId, completedOn } = partialCompletion;
    const actionId = actionIdBySource.get(sourceItemId);
    assert.ok(actionId);
    const completion: QueryResult<Array<{ reused: boolean }>> = await sb.rpc(
      "complete_manual_action_v1",
      {
        p_scope_id: WORKSPACE,
        p_action_id: actionId as ReturnType<typeof randomUUID>,
        p_completed_on: completedOn,
        p_explanation: `Completed package action ${index + 1}`,
        p_authored_by: null,
      },
    ) as unknown as QueryResult<Array<{ reused: boolean }>>;
    assert.equal(completion.error, null, completion.error?.message);
    const premature: QueryResult<Array<{ activation_id: string }>> = await sb
      .from("decision_report_package_interventions")
      .select("activation_id")
      .eq("activation_id", first.activation.activationId) as unknown as QueryResult<
        Array<{ activation_id: string }>
      >;
    assert.equal(premature.error, null, premature.error?.message);
    assert.equal(premature.data?.length, 0, "partial package must have no intervention");
    const primaryLeverBeforePackage: QueryResult<{ status: string } | null> = await sb
      .from("levers")
      .select("status")
      .eq("decision_id", first.activation.decisionId)
      .single() as unknown as QueryResult<{ status: string } | null>;
    assert.equal(
      primaryLeverBeforePackage.error,
      null,
      primaryLeverBeforePackage.error?.message,
    );
    assert.equal(primaryLeverBeforePackage.data?.status, "DRAFTED");
  }

  const packageClosingActionId = actionIdBySource.get("gummy-action-3");
  const latestEffectiveActionId = actionIdBySource.get("gummy-action-4");
  assert.ok(packageClosingActionId);
  assert.ok(latestEffectiveActionId);
  const finalCompletionArgs = {
    p_scope_id: WORKSPACE,
    p_action_id: packageClosingActionId as ReturnType<typeof randomUUID>,
    p_completed_on: "2026-08-12",
    p_explanation: "Completed the final package action",
    p_authored_by: null,
  };
  const finalCompletion = await sb.rpc("complete_manual_action_v1", finalCompletionArgs);
  assert.equal(finalCompletion.error, null, finalCompletion.error?.message);
  assert.equal(finalCompletion.data?.[0]?.reused, false);
  const packageIntervention = await sb.from("decision_report_package_interventions")
    .select(
      "causal_object, intervention_rule, registered_primary_action_id, " +
        "intervention_action_id, intervention_date, included_action_ids, package_hash",
    )
    .eq("activation_id", first.activation.activationId)
    .single();
  assert.equal(packageIntervention.error, null, packageIntervention.error?.message);
  const packageInterventionRow = packageIntervention.data as unknown as
    PackageInterventionAuditRow | null;
  assert.equal(packageInterventionRow?.causal_object, "decision_package");
  assert.equal(
    packageInterventionRow?.intervention_rule,
    "latest_effective_included_action",
  );
  assert.equal(
    packageInterventionRow?.registered_primary_action_id,
    first.activation.primaryLeverActionId,
  );
  assert.equal(packageInterventionRow?.intervention_action_id, latestEffectiveActionId);
  assert.equal(packageInterventionRow?.intervention_date, "2026-08-14");
  assert.deepEqual(
    packageInterventionRow?.included_action_ids,
    first.activation.actionIds,
  );
  assert.match(packageInterventionRow?.package_hash ?? "", /^[0-9a-f]{64}$/);
  const primaryLeverAfterPackage: QueryResult<{ status: string } | null> = await sb
    .from("levers")
    .select("status")
    .eq("decision_id", first.activation.decisionId)
    .single() as unknown as QueryResult<{ status: string } | null>;
  assert.equal(primaryLeverAfterPackage.error, null, primaryLeverAfterPackage.error?.message);
  assert.equal(primaryLeverAfterPackage.data?.status, "SHIPPED");

  const exactCompletionRetry = await sb.rpc(
    "complete_manual_action_v1",
    finalCompletionArgs,
  );
  assert.equal(exactCompletionRetry.error, null, exactCompletionRetry.error?.message);
  assert.equal(exactCompletionRetry.data?.[0]?.reused, true);
  const packageCount = await sb.from("decision_report_package_interventions")
    .select("*", { count: "exact", head: true })
    .eq("activation_id", first.activation.activationId);
  assert.equal(packageCount.error, null, packageCount.error?.message);
  assert.equal(packageCount.count, 1);

  const changedCompletionRetry = await sb.rpc("complete_manual_action_v1", {
    ...finalCompletionArgs,
    p_explanation: "Changed explanation must conflict",
  });
  assert.notEqual(changedCompletionRetry.error, null);

  const forgedPackageUpdate = await sb.from("decision_report_package_interventions")
    .update({ intervention_date: "2026-08-12" })
    .eq("activation_id", first.activation.activationId);
  assert.notEqual(forgedPackageUpdate.error, null);
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

  const decisionsBefore = await sb.from("decisions")
    .select("*", { count: "exact", head: true })
    .eq("scope_id", WORKSPACE);
  assert.equal(decisionsBefore.error, null, decisionsBefore.error?.message);

  const base = {
    schemaVersion: 1 as const,
    reportId: saved.saved.reportId,
    revisionId: saved.saved.revisionId,
    confirmedMetricId: METRIC,
    prediction: {
      direction: "POSITIVE" as const,
      magnitudePctMean: 15,
      resolutionDate: "2099-12-15",
    },
    selectedActionSourceItemIds: ["forged-action-id"],
    primaryLeverActionSourceItemId: "forged-action-id",
  };
  const expired = await sb.rpc("activate_decision_report_v2", {
    p_report_id: saved.saved.reportId,
    p_revision_id: saved.saved.revisionId,
    p_metric_id: METRIC,
    p_prediction_direction: "POSITIVE",
    p_prediction_magnitude_pct_mean: 15,
    p_prediction_resolution_date: "2000-01-01",
    p_selected_action_source_ids: ["gummy-action-1"],
    p_primary_lever_source_id: "gummy-action-1",
    p_activated_by: null,
  });
  assert.ok(expired.error);
  assert.match(expired.error?.message ?? "", /must be in the future/i);

  const forged = await materializeReportActivation(sb, base, null);
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.code, "validation");

  const otherMetric = await materializeReportActivation(sb, {
    ...base,
    confirmedMetricId: OTHER_METRIC,
    selectedActionSourceItemIds: ["gummy-action-1"],
    primaryLeverActionSourceItemId: "gummy-action-1",
  }, null);
  assert.equal(otherMetric.ok, false);
  if (!otherMetric.ok) assert.equal(otherMetric.code, "forbidden");

  const counts = await Promise.all([
    sb.from("decision_report_activations").select("*", { count: "exact", head: true }).eq("report_id", saved.saved.reportId),
    sb.from("decisions").select("*", { count: "exact", head: true }).eq("scope_id", WORKSPACE),
  ]);
  assert.equal(counts[0].count, 0);
  assert.equal(counts[1].count, decisionsBefore.count);
});

test("v3 rejects viewers, forged actors, and cross-workspace metrics without leaking or writing", async (t) => {
  if (!authenticatedGated(t) || !sb || !memberSb || !viewerSb || !memberUserId || !viewerUserId) {
    return;
  }

  const [memberCatalog, viewerCatalog] = await Promise.all([
    loadReportActivationMetrics(memberSb, WORKSPACE),
    loadReportActivationMetrics(viewerSb, WORKSPACE),
  ]);
  assert.ok(memberCatalog.some((metric) => metric.metricId === METRIC));
  assert.deepEqual(viewerCatalog, memberCatalog);
  await assert.rejects(
    loadReportActivationMetrics(memberSb, OTHER_WORKSPACE),
    (error: { code?: string; message?: string }) =>
      error.code === "42501" && /unavailable/i.test(error.message ?? ""),
  );

  const outsiderSaved = await saveDecisionReport(sb, OTHER_WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(
    outsiderSaved.ok,
    true,
    outsiderSaved.ok ? undefined : outsiderSaved.error,
  );
  if (!outsiderSaved.ok) return;
  const outsiderInput: ReportActivationInputV2 = {
    schemaVersion: 2,
    reportId: outsiderSaved.saved.reportId,
    revisionId: outsiderSaved.saved.revisionId,
    confirmedMetricId: OTHER_METRIC,
    selectedMetricIds: [OTHER_METRIC],
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: 10,
      resolutionDate: "2099-12-15",
    },
    selectedActionSourceItemIds: ["gummy-action-1"],
    actionMetricAssignments: [{
      actionSourceItemId: "gummy-action-1",
      metricId: OTHER_METRIC,
    }],
    primaryLeverActionSourceItemId: "gummy-action-1",
  };
  const crossWorkspacePreflight = await authorizeReportActivationTarget(sb, {
    scopeId: WORKSPACE,
    reportId: outsiderInput.reportId,
    revisionId: outsiderInput.revisionId,
  });
  assert.deepEqual(crossWorkspacePreflight, {
    ok: false,
    code: "forbidden",
    error: "This report is unavailable in the current workspace.",
  });
  const outsiderActivation = await materializeReportActivation(sb, outsiderInput, null);
  assert.equal(
    outsiderActivation.ok,
    true,
    outsiderActivation.ok ? undefined : outsiderActivation.error,
  );
  if (!outsiderActivation.ok) return;

  const saved = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(saved.ok, true, saved.ok ? undefined : saved.error);
  if (!saved.ok) return;

  const input: ReportActivationInputV2 = {
    schemaVersion: 2,
    reportId: saved.saved.reportId,
    revisionId: saved.saved.revisionId,
    confirmedMetricId: METRIC,
    selectedMetricIds: [METRIC],
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: 12,
      resolutionDate: "2099-12-15",
    },
    selectedActionSourceItemIds: ["gummy-action-1"],
    actionMetricAssignments: [{
      actionSourceItemId: "gummy-action-1",
      metricId: METRIC,
    }],
    primaryLeverActionSourceItemId: "gummy-action-1",
  };

  const [viewerAttempt, forgedActor, crossWorkspaceMetric, crossWorkspaceReport] = await Promise.all([
    materializeReportActivation(viewerSb, input, viewerUserId),
    materializeReportActivation(memberSb, input, viewerUserId),
    materializeReportActivation(memberSb, {
      ...input,
      confirmedMetricId: OTHER_METRIC,
      selectedMetricIds: [OTHER_METRIC],
      actionMetricAssignments: [{
        actionSourceItemId: "gummy-action-1",
        metricId: OTHER_METRIC,
      }],
    }, memberUserId),
    materializeReportActivation(memberSb, outsiderInput, memberUserId),
  ]);
  for (const result of [
    viewerAttempt,
    forgedActor,
    crossWorkspaceMetric,
    crossWorkspaceReport,
  ]) {
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "forbidden");
      assert.equal(result.error, "This report or metric is unavailable in the current workspace.");
    }
  }

  const before = await sb.from("decision_report_activations")
    .select("*", { count: "exact", head: true })
    .eq("report_id", saved.saved.reportId);
  assert.equal(before.error, null, before.error?.message);
  assert.equal(before.count, 0);

  const memberActivation = await materializeReportActivation(memberSb, input, memberUserId);
  assert.equal(
    memberActivation.ok,
    true,
    memberActivation.ok ? undefined : memberActivation.error,
  );
  if (!memberActivation.ok) return;

  const [
    viewerMetrics,
    viewerBindings,
    hiddenCrossWorkspaceMetrics,
    hiddenCrossWorkspaceBindings,
    deniedInsert,
  ] = await Promise.all([
    viewerSb.from("decision_report_activation_metrics")
      .select("metric_id")
      .eq("activation_id", memberActivation.activation.activationId),
    viewerSb.from("decision_report_activation_action_metrics")
      .select("action_id, metric_id")
      .eq("activation_id", memberActivation.activation.activationId),
    memberSb.from("decision_report_activation_metrics")
      .select("metric_id")
      .eq("activation_id", outsiderActivation.activation.activationId),
    memberSb.from("decision_report_activation_action_metrics")
      .select("action_id, metric_id")
      .eq("activation_id", outsiderActivation.activation.activationId),
    viewerSb.from("decision_report_activation_metrics").insert({
      activation_id: memberActivation.activation.activationId,
      scope_id: WORKSPACE,
      metric_id: SECONDARY_METRIC,
    }),
  ]);
  assert.equal(viewerMetrics.error, null, viewerMetrics.error?.message);
  assert.equal(viewerMetrics.data?.length, 1);
  assert.equal(viewerBindings.error, null, viewerBindings.error?.message);
  assert.equal(viewerBindings.data?.length, 1);
  assert.equal(hiddenCrossWorkspaceMetrics.error, null, hiddenCrossWorkspaceMetrics.error?.message);
  assert.equal(hiddenCrossWorkspaceMetrics.data?.length, 0);
  assert.equal(hiddenCrossWorkspaceBindings.error, null, hiddenCrossWorkspaceBindings.error?.message);
  assert.equal(hiddenCrossWorkspaceBindings.data?.length, 0);
  assert.equal(deniedInsert.error?.code, "42501");
});

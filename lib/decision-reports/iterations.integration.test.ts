import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { materializeReportActivation } from "./materialization.ts";
import {
  deleteDecisionReport,
  saveDecisionReport,
  startDecisionReportIteration,
} from "./persistence.ts";
import { cloneDecisionReport } from "./schema.ts";

function localEnv() {
  try {
    return Object.fromEntries(readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n").flatMap((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      return match && !line.trim().startsWith("#") ? [[match[1], match[2]]] : [];
    }));
  } catch { return {} as Record<string, string>; }
}
const env = localEnv();
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const ORG = randomUUID(), PROJECT = randomUUID(), WORKSPACE = randomUUID(), METRIC = randomUUID();
let sb: SupabaseClient | null = null;
let available = false;

before(async () => {
  if (!URL || !KEY) return;
  sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const [seriesProbe, workspacePointerProbe] = await Promise.all([
    sb.from("decision_report_series").select("series_id").limit(1),
    sb.from("workspaces").select("current_decision_report_series_id").limit(1),
  ]);
  if (seriesProbe.error || workspacePointerProbe.error) return;
  available = true;
  assert.equal((await sb.from("orgs").insert({ org_id: ORG, name: "ITERATION_TEST" })).error, null);
  assert.equal((await sb.from("projects").insert({ project_id: PROJECT, org_id: ORG, name: "Orbit" })).error, null);
  assert.equal((await sb.from("workspaces").insert({ workspace_id: WORKSPACE, project_id: PROJECT, name: "Series" })).error, null);
  assert.equal((await sb.from("metrics").insert({ metric_id: METRIC, scope_id: WORKSPACE, name: "Completion", source: "declared", unit: "percent" })).error, null);
});
after(async () => { if (available && sb) await sb.from("orgs").delete().eq("org_id", ORG); });
function gated(t: TestContext) { if (!available) t.skip("local Slice 10 migration unavailable"); return available; }

async function saveReadyReport(client: SupabaseClient) {
  const result = await saveDecisionReport(client, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    authoredBy: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
  });
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  return result.saved;
}

async function activate(
  client: SupabaseClient,
  reportId: string,
  revisionId: string,
  magnitudePctMean: number,
) {
  return materializeReportActivation(client, {
    schemaVersion: 1,
    reportId,
    revisionId,
    confirmedMetricId: METRIC,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean,
      resolutionDate: "2099-01-01",
    },
    selectedActionSourceItemIds: [
      GUMMY_ALPHA_GOLDEN_EXAMPLE.report.implementation.actions[0].sourceItemId,
    ],
    primaryLeverActionSourceItemId:
      GUMMY_ALPHA_GOLDEN_EXAMPLE.report.implementation.actions[0].sourceItemId,
  }, null);
}

test("three successor cycles are retry-safe and deletion rolls both explicit pointers back safely", async (t) => {
  if (!gated(t) || !sb) return;
  const first = await saveReadyReport(sb);
  let reportId = first.reportId;
  let revisionId = first.revisionId;
  const reportIds = [reportId];
  for (let iteration = 1; iteration <= 4; iteration += 1) {
    const activation = await activate(sb, reportId, revisionId, 5 + iteration);
    assert.equal(activation.ok, true, activation.ok ? undefined : activation.error);
    if (!activation.ok) return;
    assert.equal(activation.activation.reused, false);
    const activationRetry = await activate(sb, reportId, revisionId, 5 + iteration);
    assert.equal(activationRetry.ok, true, activationRetry.ok ? undefined : activationRetry.error);
    if (activationRetry.ok) {
      assert.equal(activationRetry.activation.reused, true);
      assert.equal(activationRetry.activation.activationId, activation.activation.activationId);
    }
    if (iteration === 4) break;
    const reason = `Iteration ${iteration + 1}`;
    const started = await startDecisionReportIteration(sb, WORKSPACE, reportId, reason, null);
    assert.equal(started.ok, true, started.ok ? undefined : started.error);
    if (!started.ok) return;
    const retry = await startDecisionReportIteration(sb, WORKSPACE, reportId, reason, null);
    assert.equal(retry.ok && retry.reused, true);
    const changed = await startDecisionReportIteration(sb, WORKSPACE, reportId, `${reason} changed`, null);
    assert.equal(changed.ok, false);
    reportId = started.reportId;
    revisionId = started.revisionId;
    reportIds.push(reportId);
  }
  const reports = await sb.from("decision_reports").select("report_id, series_id, iteration_number, predecessor_report_id, status").in("report_id", reportIds).order("iteration_number");
  assert.equal(reports.error, null);
  assert.deepEqual((reports.data ?? []).map((row) => row.iteration_number), [1, 2, 3, 4]);
  assert.equal(new Set((reports.data ?? []).map((row) => row.series_id)).size, 1);
  const seriesId = reports.data![0].series_id;
  const series = await sb.from("decision_report_series").select("current_active_report_id").eq("series_id", seriesId).single();
  assert.equal(series.data?.current_active_report_id, reportIds[3]);
  const workspace = await sb.from("workspaces").select("current_decision_report_series_id").eq("workspace_id", WORKSPACE).single();
  assert.equal(workspace.error, null, workspace.error?.message);
  assert.equal(workspace.data?.current_decision_report_series_id, seriesId);
  assert.equal((await sb.from("decision_report_activations").select("activation_id", { count: "exact", head: true }).in("report_id", reportIds)).count, 4);

  const removed = await deleteDecisionReport(sb, WORKSPACE, reportIds[3], null);
  assert.equal(removed.ok, true, removed.ok ? undefined : removed.error);
  if (!removed.ok) return;
  assert.equal(removed.reused, false);
  const deleteRetry = await deleteDecisionReport(sb, WORKSPACE, reportIds[3], null);
  assert.equal(deleteRetry.ok && deleteRetry.reused, true);

  const [seriesAfterDelete, workspaceAfterDelete] = await Promise.all([
    sb.from("decision_report_series").select("current_active_report_id").eq("series_id", seriesId).single(),
    sb.from("workspaces").select("current_decision_report_series_id").eq("workspace_id", WORKSPACE).single(),
  ]);
  assert.equal(seriesAfterDelete.error, null, seriesAfterDelete.error?.message);
  assert.equal(seriesAfterDelete.data?.current_active_report_id, reportIds[2]);
  assert.equal(workspaceAfterDelete.error, null, workspaceAfterDelete.error?.message);
  assert.equal(workspaceAfterDelete.data?.current_decision_report_series_id, seriesId);

  const deletedAudit = await sb
    .from("decision_report_activations")
    .select("decision_id, prediction_id, action_ids")
    .eq("report_id", reportIds[3])
    .single();
  assert.equal(deletedAudit.error, null, deletedAudit.error?.message);
  const preservedCanonicalRows = await Promise.all([
    sb.from("decisions").select("decision_id", { count: "exact", head: true }).eq("decision_id", deletedAudit.data!.decision_id),
    sb.from("predictions").select("prediction_id", { count: "exact", head: true }).eq("prediction_id", deletedAudit.data!.prediction_id),
    sb.from("actions").select("action_id", { count: "exact", head: true }).in("action_id", deletedAudit.data!.action_ids),
  ]);
  assert.deepEqual(preservedCanonicalRows.map((result) => result.count), [1, 1, 1]);

  const replacement = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    reportIds[2],
    "Replace the removed fourth iteration",
    null,
  );
  assert.equal(replacement.ok, true, replacement.ok ? undefined : replacement.error);
  if (!replacement.ok) return;
  assert.equal(replacement.iterationNumber, 5);
  assert.notEqual(replacement.reportId, reportIds[3]);
  assert.notEqual(replacement.revisionId, revisionId);
  const replacementRetry = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    reportIds[2],
    "Replace the removed fourth iteration",
    null,
  );
  assert.equal(replacementRetry.ok && replacementRetry.reused, true);
  const [replacementRow, pointerAfterReplacement, workspaceAfterReplacement] = await Promise.all([
    sb
      .from("decision_reports")
      .select("predecessor_report_id, iteration_number")
      .eq("report_id", replacement.reportId)
      .single(),
    sb
      .from("decision_report_series")
      .select("current_active_report_id")
      .eq("series_id", seriesId)
      .single(),
    sb
      .from("workspaces")
      .select("current_decision_report_series_id")
      .eq("workspace_id", WORKSPACE)
      .single(),
  ]);
  assert.equal(replacementRow.error, null, replacementRow.error?.message);
  assert.deepEqual(replacementRow.data, {
    predecessor_report_id: reportIds[2],
    iteration_number: 5,
  });
  assert.equal(pointerAfterReplacement.error, null, pointerAfterReplacement.error?.message);
  assert.equal(pointerAfterReplacement.data?.current_active_report_id, reportIds[2]);
  assert.equal(workspaceAfterReplacement.error, null, workspaceAfterReplacement.error?.message);
  assert.equal(workspaceAfterReplacement.data?.current_decision_report_series_id, seriesId);
});

test("a deleted draft successor can be replaced without reusing its historical iteration", async (t) => {
  if (!gated(t) || !sb) return;

  const parent = await saveReadyReport(sb);
  const activation = await activate(sb, parent.reportId, parent.revisionId, 10);
  assert.equal(activation.ok, true, activation.ok ? undefined : activation.error);
  const removedDraft = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    parent.reportId,
    "First draft successor",
    null,
  );
  assert.equal(removedDraft.ok, true, removedDraft.ok ? undefined : removedDraft.error);
  if (!removedDraft.ok) return;
  assert.equal(removedDraft.iterationNumber, 2);
  const removed = await deleteDecisionReport(sb, WORKSPACE, removedDraft.reportId, null);
  assert.equal(removed.ok, true, removed.ok ? undefined : removed.error);

  const replacement = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    parent.reportId,
    "Replacement draft successor",
    null,
  );
  assert.equal(replacement.ok, true, replacement.ok ? undefined : replacement.error);
  if (!replacement.ok) return;
  assert.equal(replacement.iterationNumber, 3);
  assert.notEqual(replacement.reportId, removedDraft.reportId);
  assert.notEqual(replacement.revisionId, removedDraft.revisionId);
  const retry = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    parent.reportId,
    "Replacement draft successor",
    null,
  );
  assert.equal(retry.ok && retry.reused, true);

  const [rows, series, workspace] = await Promise.all([
    sb
      .from("decision_reports")
      .select("report_id, predecessor_report_id, iteration_number, deleted_at")
      .in("report_id", [removedDraft.reportId, replacement.reportId])
      .order("iteration_number"),
    sb
      .from("decision_report_series")
      .select("current_active_report_id")
      .eq("series_id", replacement.seriesId)
      .single(),
    sb
      .from("workspaces")
      .select("current_decision_report_series_id")
      .eq("workspace_id", WORKSPACE)
      .single(),
  ]);
  assert.equal(rows.error, null, rows.error?.message);
  assert.deepEqual(rows.data?.map((row) => row.iteration_number), [2, 3]);
  assert.ok(rows.data?.[0].deleted_at);
  assert.equal(rows.data?.[1].deleted_at, null);
  assert.equal(rows.data?.[1].predecessor_report_id, parent.reportId);
  assert.equal(series.error, null, series.error?.message);
  assert.equal(series.data?.current_active_report_id, parent.reportId);
  assert.equal(workspace.error, null, workspace.error?.message);
  assert.equal(workspace.data?.current_decision_report_series_id, replacement.seriesId);
});

test("workspace current selection is explicit when multiple independent series are active", async (t) => {
  if (!gated(t) || !sb) return;

  const first = await saveReadyReport(sb);
  const firstActivation = await activate(sb, first.reportId, first.revisionId, 11);
  assert.equal(firstActivation.ok, true, firstActivation.ok ? undefined : firstActivation.error);

  const second = await saveReadyReport(sb);
  const secondActivation = await activate(sb, second.reportId, second.revisionId, 12);
  assert.equal(secondActivation.ok, true, secondActivation.ok ? undefined : secondActivation.error);

  const reports = await sb
    .from("decision_reports")
    .select("report_id, series_id")
    .in("report_id", [first.reportId, second.reportId]);
  assert.equal(reports.error, null, reports.error?.message);
  const firstSeriesId = reports.data?.find((row) => row.report_id === first.reportId)?.series_id;
  const secondSeriesId = reports.data?.find((row) => row.report_id === second.reportId)?.series_id;
  assert.ok(firstSeriesId);
  assert.ok(secondSeriesId);
  assert.notEqual(firstSeriesId, secondSeriesId);

  const [seriesPointers, workspacePointer] = await Promise.all([
    sb
      .from("decision_report_series")
      .select("series_id, current_active_report_id")
      .in("series_id", [firstSeriesId, secondSeriesId]),
    sb
      .from("workspaces")
      .select("current_decision_report_series_id")
      .eq("workspace_id", WORKSPACE)
      .single(),
  ]);
  assert.equal(seriesPointers.error, null, seriesPointers.error?.message);
  assert.deepEqual(
    new Map(seriesPointers.data?.map((row) => [row.series_id, row.current_active_report_id])),
    new Map([
      [firstSeriesId, first.reportId],
      [secondSeriesId, second.reportId],
    ]),
  );
  assert.equal(workspacePointer.error, null, workspacePointer.error?.message);
  assert.equal(workspacePointer.data?.current_decision_report_series_id, secondSeriesId);
});

test("a successor activation fails atomically when deletion makes its parent stale", async (t) => {
  if (!gated(t) || !sb) return;

  const parent = await saveReadyReport(sb);
  const parentActivation = await activate(sb, parent.reportId, parent.revisionId, 13);
  assert.equal(parentActivation.ok, true, parentActivation.ok ? undefined : parentActivation.error);
  const successor = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    parent.reportId,
    "Re-evaluate after the first rollout",
    null,
  );
  assert.equal(successor.ok, true, successor.ok ? undefined : successor.error);
  if (!successor.ok) return;

  const removedParent = await deleteDecisionReport(sb, WORKSPACE, parent.reportId, null);
  assert.equal(removedParent.ok, true, removedParent.ok ? undefined : removedParent.error);
  const staleActivation = await activate(sb, successor.reportId, successor.revisionId, 14);
  assert.equal(staleActivation.ok, false);
  if (!staleActivation.ok) assert.equal(staleActivation.code, "conflict");

  const [successorActivationCount, report, series] = await Promise.all([
    sb
      .from("decision_report_activations")
      .select("activation_id", { count: "exact", head: true })
      .eq("report_id", successor.reportId),
    sb
      .from("decision_reports")
      .select("status, active_activation_id")
      .eq("report_id", successor.reportId)
      .single(),
    sb
      .from("decision_report_series")
      .select("current_active_report_id")
      .eq("series_id", successor.seriesId)
      .single(),
  ]);
  assert.equal(successorActivationCount.error, null, successorActivationCount.error?.message);
  assert.equal(successorActivationCount.count, 0);
  assert.equal(report.error, null, report.error?.message);
  assert.equal(report.data?.status, "report_ready");
  assert.equal(report.data?.active_activation_id, null);
  assert.equal(series.error, null, series.error?.message);
  assert.equal(series.data?.current_active_report_id, null);
});

test("a successor snapshot strips private asset IDs without reusing parent asset metadata", async (t) => {
  if (!gated(t) || !sb) return;

  const parent = await saveReadyReport(sb);
  const reserved = await sb.rpc("reserve_decision_report_asset_v1", {
    p_report_id: parent.reportId,
    p_base_revision_id: parent.revisionId,
    p_extension: "png",
    p_authored_by: null,
  });
  assert.equal(reserved.error, null, reserved.error?.message);
  const reservation = Array.isArray(reserved.data)
    ? reserved.data[0] as { asset_id: string; object_path: string }
    : null;
  assert.ok(reservation?.asset_id);
  assert.ok(reservation?.object_path);

  const reportWithAsset = cloneDecisionReport(parent.report);
  reportWithAsset.implementation.assetIds = [reservation.asset_id];
  const attached = await sb.rpc("attach_decision_report_asset_v1", {
    p_asset_id: reservation.asset_id,
    p_report_id: parent.reportId,
    p_base_revision_id: parent.revisionId,
    p_title: reportWithAsset.title,
    p_status: "report_ready",
    p_snapshot: reportWithAsset,
    p_metric_projection: parent.metricProjection,
    p_media_type: "image/png",
    p_byte_size: 100,
    p_width: 10,
    p_height: 10,
    p_content_hash: "a".repeat(64),
    p_authored_by: null,
  });
  assert.equal(attached.error, null, attached.error?.message);
  const attachedRevision = Array.isArray(attached.data)
    ? attached.data[0] as { revision_id: string }
    : null;
  assert.ok(attachedRevision?.revision_id);

  const parentActivation = await activate(sb, parent.reportId, attachedRevision.revision_id, 15);
  assert.equal(parentActivation.ok, true, parentActivation.ok ? undefined : parentActivation.error);
  const successor = await startDecisionReportIteration(
    sb,
    WORKSPACE,
    parent.reportId,
    "Refresh the report without carrying private files forward",
    null,
  );
  assert.equal(successor.ok, true, successor.ok ? undefined : successor.error);
  if (!successor.ok) return;

  const [revision, parentAsset, successorAssets] = await Promise.all([
    sb
      .from("decision_report_revisions")
      .select("snapshot")
      .eq("revision_id", successor.revisionId)
      .single(),
    sb
      .from("report_assets")
      .select("asset_id, report_id, object_path, status")
      .eq("asset_id", reservation.asset_id)
      .single(),
    sb
      .from("report_assets")
      .select("asset_id", { count: "exact", head: true })
      .eq("report_id", successor.reportId),
  ]);
  assert.equal(revision.error, null, revision.error?.message);
  const snapshot = revision.data?.snapshot as { implementation?: { assetIds?: string[] } };
  assert.deepEqual(snapshot.implementation?.assetIds, []);
  assert.equal(parentAsset.error, null, parentAsset.error?.message);
  assert.equal(parentAsset.data?.report_id, parent.reportId);
  assert.equal(parentAsset.data?.status, "attached");
  assert.equal(parentAsset.data?.object_path, reservation.object_path);
  assert.equal(successorAssets.error, null, successorAssets.error?.message);
  assert.equal(successorAssets.count, 0);

  const successorReservation = await sb.rpc("reserve_decision_report_asset_v1", {
    p_report_id: successor.reportId,
    p_base_revision_id: successor.revisionId,
    p_extension: "png",
    p_authored_by: null,
  });
  assert.equal(successorReservation.error, null, successorReservation.error?.message);
  const successorAsset = Array.isArray(successorReservation.data)
    ? successorReservation.data[0] as { asset_id: string; object_path: string }
    : null;
  assert.ok(successorAsset?.asset_id);
  assert.ok(successorAsset?.object_path);
  assert.notEqual(successorAsset.asset_id, reservation.asset_id);
  assert.notEqual(successorAsset.object_path, reservation.object_path);

  const successorReportWithAsset = cloneDecisionReport(parent.report);
  successorReportWithAsset.implementation.assetIds = [successorAsset.asset_id];
  const successorAttached = await sb.rpc("attach_decision_report_asset_v1", {
    p_asset_id: successorAsset.asset_id,
    p_report_id: successor.reportId,
    p_base_revision_id: successor.revisionId,
    p_title: successorReportWithAsset.title,
    p_status: "report_ready",
    p_snapshot: successorReportWithAsset,
    p_metric_projection: parent.metricProjection,
    p_media_type: "image/png",
    p_byte_size: 100,
    p_width: 10,
    p_height: 10,
    p_content_hash: "b".repeat(64),
    p_authored_by: null,
  });
  assert.equal(successorAttached.error, null, successorAttached.error?.message);

  const [parentAfterReattach, successorAfterReattach] = await Promise.all([
    sb
      .from("report_assets")
      .select("asset_id, report_id, object_path, status")
      .eq("asset_id", reservation.asset_id)
      .single(),
    sb
      .from("report_assets")
      .select("asset_id, report_id, object_path, status")
      .eq("asset_id", successorAsset.asset_id)
      .single(),
  ]);
  assert.equal(parentAfterReattach.error, null, parentAfterReattach.error?.message);
  assert.equal(parentAfterReattach.data?.report_id, parent.reportId);
  assert.equal(parentAfterReattach.data?.object_path, reservation.object_path);
  assert.equal(parentAfterReattach.data?.status, "attached");
  assert.equal(successorAfterReattach.error, null, successorAfterReattach.error?.message);
  assert.equal(successorAfterReattach.data?.report_id, successor.reportId);
  assert.equal(successorAfterReattach.data?.object_path, successorAsset.object_path);
  assert.equal(successorAfterReattach.data?.status, "attached");
});

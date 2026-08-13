import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { cloneDecisionReport } from "./schema.ts";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { createSafeFallbackReport } from "./generation-contract.ts";
import { deleteDecisionReport, loadDecisionReport, saveDecisionReport } from "./persistence.ts";

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
const WORKSPACE = randomUUID();

let sb: SupabaseClient | null = null;
let authenticatedSb: SupabaseClient | null = null;
let authenticatedUserId: string | null = null;
let available = false;
const AUTH_EMAIL = `report-provenance-${randomUUID()}@example.test`;
const AUTH_PASSWORD = `Causent-${randomUUID()}-A1!`;

async function teardown(client: SupabaseClient) {
  await client.from("orgs").delete().eq("org_id", ORG);
}

before(async () => {
  if (!URL || !KEY) return;
  sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = await sb
    .from("decision_reports")
    .select("report_id")
    .limit(1)
    .then((result) => result, () => ({ error: new Error("unreachable") }));
  if (probe.error) return;

  available = true;
  await teardown(sb);
  const org = await sb.from("orgs").insert({ org_id: ORG, name: "REPORT_TEST_org" });
  assert.equal(org.error, null, org.error?.message);
  const project = await sb
    .from("projects")
    .insert({ project_id: PROJECT, org_id: ORG, name: "Orbit" });
  assert.equal(project.error, null, project.error?.message);
  const workspace = await sb
    .from("workspaces")
    .insert({ workspace_id: WORKSPACE, project_id: PROJECT, name: "Gummy Alpha" });
  assert.equal(workspace.error, null, workspace.error?.message);

  if (ANON_KEY) {
    const createdUser = await sb.auth.admin.createUser({
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
      email_confirm: true,
    });
    assert.equal(createdUser.error, null, createdUser.error?.message);
    authenticatedUserId = createdUser.data.user?.id ?? null;
    assert.ok(authenticatedUserId);
    const membership = await sb.from("memberships").insert({
      user_id: authenticatedUserId,
      org_id: ORG,
      role: "member",
    });
    assert.equal(membership.error, null, membership.error?.message);
    authenticatedSb = createClient(URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await authenticatedSb.auth.signInWithPassword({
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
    });
    assert.equal(signedIn.error, null, signedIn.error?.message);
  }
});

after(async () => {
  if (sb && available) await teardown(sb);
  if (sb && authenticatedUserId) await sb.auth.admin.deleteUser(authenticatedUserId);
});

function gated(t: TestContext): boolean {
  if (!available) {
    t.skip("Decision Report persistence migration is unavailable — start/reset local Supabase");
    return false;
  }
  return true;
}

function authenticatedGated(t: TestContext): boolean {
  if (!gated(t)) return false;
  if (!authenticatedSb || !authenticatedUserId || !sb) {
    t.skip("Authenticated Supabase provenance fixture is unavailable");
    return false;
  }
  return true;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function mintSourceReceipt(snapshot = GUMMY_ALPHA_GOLDEN_EXAMPLE.report) {
  assert.ok(sb);
  assert.ok(authenticatedUserId);
  const minted = await sb.rpc("mint_decision_report_source_receipt_v1", {
    p_scope_id: WORKSPACE,
    p_authored_by: authenticatedUserId,
    p_generated_snapshot: snapshot,
  });
  assert.equal(minted.error, null, minted.error?.message);
  assert.equal(minted.data?.length, 1);
  const receiptId = minted.data?.[0]?.source_receipt_id;
  assert.equal(typeof receiptId, "string");
  return receiptId as string;
}

test("explicit saves are append-only, retry-safe, conflict-safe, and create no graph rows", async (t) => {
  if (!gated(t) || !sb) return;

  const workspaceProbe = await sb
    .from("workspaces")
    .select("workspace_id")
    .eq("workspace_id", WORKSPACE)
    .maybeSingle();
  assert.equal(workspaceProbe.error, null, workspaceProbe.error?.message);
  assert.equal(workspaceProbe.data?.workspace_id, WORKSPACE);

  const first = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(first.ok, true, first.ok ? undefined : first.error);
  if (!first.ok) return;
  assert.equal(first.saved.status, "report_ready");
  assert.equal(first.reused, false);

  const retry = await saveDecisionReport(sb, WORKSPACE, {
    reportId: first.saved.reportId,
    baseRevisionId: first.saved.revisionId,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(retry.ok, true, retry.ok ? undefined : retry.error);
  if (!retry.ok) return;
  assert.equal(retry.reused, true);
  assert.equal(retry.saved.revisionId, first.saved.revisionId);

  const editedReport = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  editedReport.decision.decision[0] = {
    ...editedReport.decision.decision[0],
    text: "Deploy the assistant to a limited Gummy Alpha partner cohort first.",
    status: "user_confirmed",
    sourceChunkIds: [],
  };
  const selectedActionId = editedReport.implementation.actions[0].sourceItemId;
  editedReport.activationDraft = {
    confirmedMetricId: randomUUID(),
    selectedActionSourceItemIds: [selectedActionId],
    primaryLeverActionSourceItemId: selectedActionId,
    prediction: {
      direction: "NEGATIVE",
      magnitudePctMean: 8.5,
      resolutionDate: "2099-12-15",
    },
  };
  const edited = await saveDecisionReport(sb, WORKSPACE, {
    reportId: first.saved.reportId,
    baseRevisionId: first.saved.revisionId,
    report: editedReport,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(edited.ok, true, edited.ok ? undefined : edited.error);
  if (!edited.ok) return;
  assert.equal(edited.reused, false);
  assert.notEqual(edited.saved.revisionId, first.saved.revisionId);
  assert.equal(edited.saved.baseRevisionId, first.saved.revisionId);

  const staleReport = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  staleReport.title = "A stale edit from another tab";
  const stale = await saveDecisionReport(sb, WORKSPACE, {
    reportId: first.saved.reportId,
    baseRevisionId: first.saved.revisionId,
    report: staleReport,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.code, "conflict");
    assert.equal(stale.currentRevisionId, edited.saved.revisionId);
  }

  const revisions = await sb
    .from("decision_report_revisions")
    .select("revision_id, revision_number")
    .eq("report_id", first.saved.reportId)
    .order("revision_number");
  assert.equal(revisions.error, null);
  assert.deepEqual(revisions.data?.map((row) => row.revision_number), [1, 2]);

  const loaded = await loadDecisionReport(sb, WORKSPACE, first.saved.reportId);
  assert.equal(loaded.ok, true, loaded.ok ? undefined : loaded.error);
  if (loaded.ok) {
    assert.equal(loaded.saved.revisionId, edited.saved.revisionId);
    assert.deepEqual(loaded.saved.report, editedReport);
    assert.deepEqual(
      loaded.saved.metricProjection,
      GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    );
  }

  const canonicalCounts = await Promise.all([
    sb.from("decisions").select("*", { count: "exact", head: true }).eq("scope_id", WORKSPACE),
    sb.from("predictions").select("*", { count: "exact", head: true }).eq("scope_id", WORKSPACE),
    sb.from("actions").select("*", { count: "exact", head: true }).eq("scope_id", WORKSPACE),
    sb.from("levers").select("*", { count: "exact", head: true }).eq("scope_id", WORKSPACE),
  ]);
  for (const [index, table] of ["decisions", "predictions", "actions", "levers"].entries()) {
    const countResult = canonicalCounts[index];
    assert.equal(countResult.error, null, `${table}: ${countResult.error?.message}`);
    assert.equal(countResult.count, 0, `${table} must remain untouched by report saves`);
  }
});

test("the database refuses report_ready for a sparse snapshot", async (t) => {
  if (!gated(t) || !sb) return;
  let index = 0;
  const fallback = createSafeFallbackReport("Launch a new partner onboarding experience.", {
    idFactory: () => `db-fallback-${index++}`,
  });
  const result = await sb.rpc("create_decision_report_v1", {
    p_scope_id: WORKSPACE,
    p_title: fallback.report.title,
    p_status: "report_ready",
    p_snapshot: fallback.report,
    p_metric_projection: fallback.metricProjection,
    p_authored_by: null,
  });
  assert.equal(result.error?.code, "22023");
  assert.match(result.error?.message ?? "", /Required report fields are incomplete/);
});

test("the database requires decision context and a plan but not evidence or metric rationale for report_ready", async (t) => {
  if (!gated(t) || !sb) return;
  const optionalAnalysis = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  optionalAnalysis.title = "Ready without supplied evidence or metric rationale";
  optionalAnalysis.supportingEvidence.factors = [{
    ...optionalAnalysis.supportingEvidence.factors[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  }];
  optionalAnalysis.supportingEvidence.metricMechanism = [{
    ...optionalAnalysis.supportingEvidence.metricMechanism[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  }];
  const mintedReady = await sb.rpc("mint_decision_report_source_receipt_v1", {
    p_scope_id: WORKSPACE,
    p_authored_by: null,
    p_generated_snapshot: optionalAnalysis,
  });
  assert.equal(mintedReady.error, null, mintedReady.error?.message);
  const sourceReceiptId = mintedReady.data?.[0]?.source_receipt_id;
  assert.equal(typeof sourceReceiptId, "string");
  const ready = await sb.rpc("create_decision_report_v2", {
    p_scope_id: WORKSPACE,
    p_title: optionalAnalysis.title,
    p_status: "report_ready",
    p_snapshot: optionalAnalysis,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: null,
    p_source_receipt_id: sourceReceiptId,
  });
  assert.equal(ready.error, null, ready.error?.message);
  assert.equal(ready.data?.[0]?.status, "report_ready");

  const requiredCases: Array<{
    label: string;
    clear: (report: typeof optionalAnalysis) => void;
  }> = [
    {
      label: "background",
      clear: (report) => {
        report.decision.background[0] = {
          ...report.decision.background[0],
          text: "",
          status: "missing",
          sourceChunkIds: [],
        };
      },
    },
    {
      label: "problem",
      clear: (report) => {
        report.decision.problem[0] = {
          ...report.decision.problem[0],
          text: "",
          status: "missing",
          sourceChunkIds: [],
        };
      },
    },
    {
      label: "decision",
      clear: (report) => {
        report.decision.decision[0] = {
          ...report.decision.decision[0],
          text: "",
          status: "missing",
          sourceChunkIds: [],
        };
      },
    },
    {
      label: "action plan summary",
      clear: (report) => {
        report.implementation.actionPlanSummary[0] = {
          ...report.implementation.actionPlanSummary[0],
          text: "",
          status: "missing",
          sourceChunkIds: [],
        };
      },
    },
    {
      label: "titled action",
      clear: (report) => {
        report.implementation.actions = report.implementation.actions.map((action) => ({
          ...action,
          title: "",
        }));
      },
    },
  ];

  for (const requiredCase of requiredCases) {
    const incomplete = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
    incomplete.title = `Missing required ${requiredCase.label}`;
    requiredCase.clear(incomplete);
    const readinessError: { code?: string; message?: string } | null = (
      await sb.rpc("create_decision_report_v1", {
        p_scope_id: WORKSPACE,
        p_title: incomplete.title,
        p_status: "report_ready",
        p_snapshot: incomplete,
        p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
        p_authored_by: null,
      })
    ).error;
    assert.equal(readinessError?.code, "22023", requiredCase.label);
    assert.match(
      readinessError?.message ?? "",
      /Required report fields are incomplete/,
      requiredCase.label,
    );
  }
});

test("the database rejects missing or tampered v2 source provenance", async (t) => {
  if (!gated(t) || !sb) return;
  const missing = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  delete missing.sourceSummaries;
  const missingResult = await sb.rpc("create_decision_report_v1", {
    p_scope_id: WORKSPACE,
    p_title: missing.title,
    p_status: "report_ready",
    p_snapshot: missing,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: null,
  });
  assert.equal(missingResult.error?.code, "22023");
  assert.match(missingResult.error?.message ?? "", /source provenance/);

  const tampered = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  tampered.sourceSummaries![0].chunks[0].text += " tampered";
  const tamperedResult = await sb.rpc("create_decision_report_v1", {
    p_scope_id: WORKSPACE,
    p_title: tampered.title,
    p_status: "report_ready",
    p_snapshot: tampered,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: null,
  });
  assert.equal(tamperedResult.error?.code, "22023");
  assert.match(tamperedResult.error?.message ?? "", /source provenance/);
});

test("server-minted receipts reject forged corpus and sourced claims across revisions", async (t) => {
  if (!authenticatedGated(t) || !authenticatedSb || !authenticatedUserId || !sb) return;

  const deniedMint = await authenticatedSb.rpc("mint_decision_report_source_receipt_v1", {
    p_scope_id: WORKSPACE,
    p_authored_by: authenticatedUserId,
    p_generated_snapshot: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
  });
  assert.equal(deniedMint.error?.code, "42501");

  // Every digest is recomputed correctly. This would pass the old v2
  // self-consistency check even though both corpus text and claim are invented.
  const forgedCorpus = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  forgedCorpus.title = "Forged corpus should not persist";
  const forgedSource = forgedCorpus.sourceSummaries![0];
  const forgedChunk = forgedSource.chunks[0];
  forgedChunk.text = "Invented research says conversion increased 99 percent.";
  forgedChunk.contentSha256 = sha256(forgedChunk.text);
  forgedSource.contentSha256 = sha256(
    forgedSource.chunks.map((chunk) => chunk.text).join("\n\n"),
  );
  forgedCorpus.decision.background[0] = {
    id: "forged-corpus-claim",
    text: "Conversion increased 99 percent.",
    status: "sourced",
    sourceChunkIds: [forgedChunk.chunkId],
  };
  const directOldCreate = await authenticatedSb.rpc("create_decision_report_v1", {
    p_scope_id: WORKSPACE,
    p_title: forgedCorpus.title,
    p_status: "report_ready",
    p_snapshot: forgedCorpus,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: authenticatedUserId,
  });
  assert.equal(directOldCreate.error?.code, "42501");
  assert.match(directOldCreate.error?.message ?? "", /receipt|unavailable/i);

  const receiptId = await mintSourceReceipt();
  const forgedClaim = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  forgedClaim.supportingEvidence.metricMechanism[0] = {
    ...forgedClaim.supportingEvidence.metricMechanism[0],
    text: "The supplied source proves this newly invented mechanism.",
    status: "sourced",
    sourceChunkIds: [forgedClaim.sourceSummaries![0].chunks[0].chunkId],
  };
  const forgedWithReceipt = await authenticatedSb.rpc("create_decision_report_v2", {
    p_scope_id: WORKSPACE,
    p_title: forgedClaim.title,
    p_status: "report_ready",
    p_snapshot: forgedClaim,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: authenticatedUserId,
    p_source_receipt_id: receiptId,
  });
  assert.equal(forgedWithReceipt.error?.code, "22023");
  assert.match(forgedWithReceipt.error?.message ?? "", /receipt.*provenance/i);

  // User edits may clear a generated sourced assertion before the first save.
  // The remaining sourced claims are an exact subset of the minted manifest.
  const cleared = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  cleared.decision.decision[0] = {
    ...cleared.decision.decision[0],
    status: "user_confirmed",
    sourceChunkIds: [],
  };
  const created = await saveDecisionReport(authenticatedSb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: receiptId,
    report: cleared,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: authenticatedUserId,
  });
  assert.equal(created.ok, true, created.ok ? undefined : created.error);
  if (!created.ok) return;
  assert.equal(created.reused, false);

  const exactRetry = await saveDecisionReport(authenticatedSb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: receiptId,
    report: cleared,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: authenticatedUserId,
  });
  assert.equal(exactRetry.ok, true, exactRetry.ok ? undefined : exactRetry.error);
  if (exactRetry.ok) {
    assert.equal(exactRetry.reused, true);
    assert.equal(exactRetry.saved.reportId, created.saved.reportId);
    assert.equal(exactRetry.saved.revisionId, created.saved.revisionId);
  }

  const changedRetry = cloneDecisionReport(cleared);
  changedRetry.title = "Changed after consuming the source receipt";
  const conflict = await saveDecisionReport(authenticatedSb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId: receiptId,
    report: changedRetry,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: authenticatedUserId,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "conflict");

  // A later revision cannot restore even an originally minted sourced claim:
  // provenance is monotonic relative to the immediately prior revision.
  const restored = cloneDecisionReport(cleared);
  restored.decision.decision[0] = structuredClone(
    GUMMY_ALPHA_GOLDEN_EXAMPLE.report.decision.decision[0],
  );
  const addedLater = await authenticatedSb.rpc("append_decision_report_revision_v1", {
    p_report_id: created.saved.reportId,
    p_base_revision_id: created.saved.revisionId,
    p_title: restored.title,
    p_status: "report_ready",
    p_snapshot: restored,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: authenticatedUserId,
  });
  assert.equal(addedLater.error?.code, "22023");
  assert.match(addedLater.error?.message ?? "", /cannot be added or changed/i);

  const changedSources = cloneDecisionReport(cleared);
  const changedSource = changedSources.sourceSummaries![0];
  changedSource.chunks[0].text += " Invented later source text.";
  changedSource.chunks[0].contentSha256 = sha256(changedSource.chunks[0].text);
  changedSource.contentSha256 = sha256(
    changedSource.chunks.map((chunk) => chunk.text).join("\n\n"),
  );
  const replacedCorpus = await authenticatedSb.rpc("append_decision_report_revision_v1", {
    p_report_id: created.saved.reportId,
    p_base_revision_id: created.saved.revisionId,
    p_title: changedSources.title,
    p_status: "report_ready",
    p_snapshot: changedSources,
    p_metric_projection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    p_authored_by: authenticatedUserId,
  });
  assert.equal(replacedCorpus.error?.code, "22023");
  assert.match(replacedCorpus.error?.message ?? "", /cannot be added or changed/i);

  const reports = await sb
    .from("decision_reports")
    .select("report_id", { count: "exact", head: true })
    .eq("scope_id", WORKSPACE)
    .in("title", [forgedCorpus.title, changedRetry.title]);
  assert.equal(reports.error, null, reports.error?.message);
  assert.equal(reports.count, 0);
});

test("local-demo service-role saves consume their one-shot source transition", async (t) => {
  if (!gated(t) || !sb) return;
  const minted = await sb.rpc("mint_decision_report_source_receipt_v1", {
    p_scope_id: WORKSPACE,
    p_authored_by: null,
    p_generated_snapshot: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
  });
  assert.equal(minted.error, null, minted.error?.message);
  const sourceReceiptId = minted.data?.[0]?.source_receipt_id;
  assert.equal(typeof sourceReceiptId, "string");
  const expiresAt = Date.parse(minted.data?.[0]?.expires_at ?? "");
  assert.ok(expiresAt > Date.now() + 23 * 60 * 60 * 1_000);

  // create_decision_report_v2 contains a post-trigger zero-residue invariant;
  // this success proves the service-role guard consumed the exact transition.
  const created = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(created.ok, true, created.ok ? undefined : created.error);
  if (!created.ok) return;

  const retry = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    sourceReceiptId,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(retry.ok, true, retry.ok ? undefined : retry.error);
  if (retry.ok) {
    assert.equal(retry.reused, true);
    assert.equal(retry.saved.reportId, created.saved.reportId);
  }
});

test("ordinary saves cannot promote an arbitrary supplied-image id", async (t) => {
  if (!gated(t) || !sb) return;
  const created = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const forged = cloneDecisionReport(created.saved.report);
  forged.implementation.assetIds = [randomUUID()];
  const result = await saveDecisionReport(sb, WORKSPACE, {
    reportId: created.saved.reportId,
    baseRevisionId: created.saved.revisionId,
    report: forged,
    metricProjection: created.saved.metricProjection,
    authoredBy: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "forbidden");
});

test("non-active reports leave history after a retry-safe soft deletion", async (t) => {
  if (!gated(t) || !sb) return;
  const created = await saveDecisionReport(sb, WORKSPACE, {
    reportId: null,
    baseRevisionId: null,
    report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    authoredBy: null,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const removed = await deleteDecisionReport(sb, WORKSPACE, created.saved.reportId, null);
  assert.equal(removed.ok, true, removed.ok ? undefined : removed.error);
  if (!removed.ok) return;
  assert.equal(removed.reused, false);
  const retry = await deleteDecisionReport(sb, WORKSPACE, created.saved.reportId, null);
  assert.equal(retry.ok, true, retry.ok ? undefined : retry.error);
  if (retry.ok) assert.equal(retry.reused, true);

  const loaded = await loadDecisionReport(sb, WORKSPACE, created.saved.reportId);
  assert.equal(loaded.ok, false);
  if (!loaded.ok) assert.equal(loaded.code, "not_found");
  const revisionCount = await sb
    .from("decision_report_revisions")
    .select("revision_id", { count: "exact", head: true })
    .eq("report_id", created.saved.reportId);
  assert.equal(revisionCount.error, null, revisionCount.error?.message);
  assert.equal(revisionCount.count, 1);
});

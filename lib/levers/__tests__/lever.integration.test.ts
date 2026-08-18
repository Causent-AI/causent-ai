// Integration gate for the create-from-decision lever spine (#16), against the
// LOCAL Supabase stack in a scratch tenant (created + torn down here). Skips
// honestly when the stack isn't reachable. Proves, with NO GitHub credentials:
//
//   1. draft → create → detect materializes the actions + lever rows and moves
//      the prediction from unattributed (no detected lever) to attributed.
//   2. the synthetic-payload webhook receiver detects, and a REDELIVERY of the
//      same event is a no-op (unique (source, provider_event_id)).
//   3. the reconciliation cron detects a lever whose webhook was missed
//      (repo poll MOCKED).
//   4. a stale draft times out → TIMED_OUT.
//
// Scope model: writes go through a client pinned to the scratch workspace, the
// same shape the server action uses with the session seam.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { draftLeverFromDecision } from "../draft.ts";
import { detectLever, markLeverCreated, parseIssueUrl } from "../detect.ts";
import { processIssueWebhook } from "../webhook.ts";
import { reconcileLevers, type LeverPoller } from "../reconcile.ts";
import { issueExternalRef, provenanceToken } from "../../connectors/github.ts";

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const SECRET = "test-webhook-secret";

// Scratch tenant (namespaced 'c3' for cold-start C3; teardown exact).
const ORG = "c3c30000-0000-0000-0000-0000000000a0";
const PROJ = "c3c30000-0000-0000-0000-0000000000a1";
const WS = "c3c30000-0000-0000-0000-0000000000a2";
const METRIC = "c3c30000-0000-0000-0000-0000000000a3";
const DECISION = "c3c30000-0000-0000-0000-0000000000a4";
const PREDICTION = "c3c30000-0000-0000-0000-0000000000a5";
const PROJ_OTHER = "c3c30000-0000-0000-0000-0000000000a6";
const WS_OTHER = "c3c30000-0000-0000-0000-0000000000a7";

let sb: SupabaseClient | null = null;
let available = false;

async function teardown(client: SupabaseClient) {
  const result = await client.from("orgs").delete().eq("org_id", ORG); // cascades the tenant
  assert.equal(result.error, null, result.error?.message);
}

async function seedTenant(client: SupabaseClient) {
  const org = await client.from("orgs").insert({ org_id: ORG, name: "C3_TEST_org" });
  assert.equal(org.error, null, org.error?.message);
  const project = await client.from("projects").insert({ project_id: PROJ, org_id: ORG, name: "p" });
  assert.equal(project.error, null, project.error?.message);
  const workspace = await client.from("workspaces").insert({ workspace_id: WS, project_id: PROJ, name: "w" });
  assert.equal(workspace.error, null, workspace.error?.message);
  const otherProject = await client.from("projects").insert({
    project_id: PROJ_OTHER,
    org_id: ORG,
    name: "other-p",
  });
  assert.equal(otherProject.error, null, otherProject.error?.message);
  const otherWorkspace = await client.from("workspaces").insert({
    workspace_id: WS_OTHER,
    project_id: PROJ_OTHER,
    name: "other-w",
  });
  assert.equal(otherWorkspace.error, null, otherWorkspace.error?.message);
  const metric = await client.from("metrics").insert({ metric_id: METRIC, scope_id: WS, name: "Activation", source: "declared" });
  assert.equal(metric.error, null, metric.error?.message);
  const decision = await client.from("decisions").insert({ decision_id: DECISION, scope_id: WS, title: "New onboarding checklist" });
  assert.equal(decision.error, null, decision.error?.message);
  // The committed prediction — UNATTRIBUTED (no lever yet).
  const prediction = await client.from("predictions").insert({
    prediction_id: PREDICTION,
    scope_id: WS,
    decision_id: DECISION,
    metric_id: METRIC,
    direction: "POSITIVE",
    magnitude_pct_mean: 6,
    resolution_date: "2026-12-31",
  });
  assert.equal(prediction.error, null, prediction.error?.message);
}

before(async () => {
  if (!URL || !KEY) return;
  sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = await sb
    .from("workspaces")
    .select("workspace_id")
    .limit(1)
    .then((r) => r, () => ({ error: new Error("unreachable") }));
  if (probe.error) return;
  available = true;
});

beforeEach(async () => {
  if (!available || !sb) return;
  await teardown(sb);
  await seedTenant(sb);
});

after(async () => {
  if (sb && available) await teardown(sb);
});

/** Whether the decision's prediction is attributed = it has a DETECTED/SHIPPED
 *  lever with an external_ref (the same boundary resolve.py / the UI use). */
async function isAttributed(client: SupabaseClient): Promise<boolean> {
  const res = await client
    .from("levers")
    .select("status, action:actions(external_ref)")
    .eq("decision_id", DECISION);
  const rows = (res.data ?? []) as unknown as Array<{ status: string; action: { external_ref: string | null } | null }>;
  return rows.some((r) => (r.status === "DETECTED" || r.status === "SHIPPED") && r.action?.external_ref);
}

function draftInput() {
  return {
    decisionId: DECISION,
    metricId: METRIC,
    repo: "acme/orbit",
    title: "Ship the onboarding checklist",
    body: "Add a 3-step first-run checklist.",
  };
}

// ============================================================================
// 1. draft → create → detect materializes actions + lever; attributes prediction
// ============================================================================
test("draft → detect materializes actions + lever and attributes the prediction", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  // Before: unattributed.
  assert.equal(await isAttributed(client), false, "prediction starts unattributed");

  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;

  // The early actions row exists with external_ref NULL; the lever is DRAFTED.
  const afterDraft = await client
    .from("levers")
    .select("status, provenance_token, action:actions(external_ref, source)")
    .eq("provenance_token", provenanceToken(DECISION))
    .single();
  const draftRow = afterDraft.data as unknown as { status: string; action: { external_ref: string | null; source: string } };
  assert.equal(draftRow.status, "DRAFTED");
  assert.equal(draftRow.action.external_ref, null);
  assert.equal(draftRow.action.source, "github_issue");
  assert.equal(await isAttributed(client), false, "draft alone does not attribute");

  // Paste-URL fallback: the user pastes the issue they created.
  const url = "https://github.com/acme/orbit/issues/77";
  const parsed = parseIssueUrl(url);
  assert.ok(parsed);
  await markLeverCreated(client, drafted.token);
  const det = await detectLever(client, {
    token: drafted.token,
    externalRef: issueExternalRef(parsed!.number),
    htmlUrl: url,
  });
  assert.equal(det.ok, true);

  // After: DETECTED, external_ref set, prediction attributed.
  const afterDetect = await client
    .from("levers")
    .select("status, action:actions(external_ref)")
    .eq("provenance_token", drafted.token)
    .single();
  const detRow = afterDetect.data as unknown as { status: string; action: { external_ref: string | null } };
  assert.equal(detRow.status, "DETECTED");
  assert.equal(detRow.action.external_ref, "github:issue:77");
  assert.equal(await isAttributed(client), true, "detection attributes the prediction");

  // Idempotent: re-detecting is a no-op.
  const again = await detectLever(client, { token: drafted.token, externalRef: "github:issue:77" });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.alreadyDetected, true);
});

test("interactive paste attribution cannot cross a same-org workspace", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;
  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;

  const wrongCreated = await markLeverCreated(client, drafted.token, WS_OTHER);
  assert.deepEqual(wrongCreated, { ok: true, updated: false });
  const wrongDetection = await detectLever(client, {
    scopeId: WS_OTHER,
    token: drafted.token,
    externalRef: "github:issue:77",
  });
  assert.equal(wrongDetection.ok, false);

  const untouched = await client
    .from("levers")
    .select("status, action:actions(external_ref)")
    .eq("provenance_token", drafted.token)
    .single();
  assert.equal(untouched.error, null);
  assert.deepEqual(untouched.data, {
    status: "DRAFTED",
    action: { external_ref: null },
  });

  const created = await markLeverCreated(client, drafted.token, WS);
  assert.deepEqual(created, { ok: true, updated: true });
  const detected = await detectLever(client, {
    scopeId: WS,
    token: drafted.token,
    externalRef: "github:issue:77",
  });
  assert.equal(detected.ok, true);
});

// ============================================================================
// 2. synthetic webhook detects; redelivery is a no-op (dedup)
// ============================================================================
test("webhook receiver detects a signed payload; redelivery is a no-op", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);

  const payload = {
    action: "opened",
    issue: {
      number: 88,
      html_url: "https://github.com/acme/orbit/issues/88",
      state: "open",
      labels: [{ name: provenanceToken(DECISION) }],
      body: "the work",
    },
  };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`;
  const delivery = "delivery-abc-123";

  const first = await processIssueWebhook(client, { rawBody, signature, deliveryId: delivery, secret: SECRET });
  assert.equal(first.result, "detected");
  assert.equal(first.status, 200);
  assert.equal(await isAttributed(client), true);

  // Redelivery of the SAME delivery id: dedup → no-op.
  const second = await processIssueWebhook(client, { rawBody, signature, deliveryId: delivery, secret: SECRET });
  assert.equal(second.result, "duplicate");

  // Exactly one transition_event recorded.
  const events = await client
    .from("transition_events")
    .select("event_id", { count: "exact", head: true })
    .eq("source", "github")
    .eq("provider_event_id", delivery);
  assert.equal(events.count, 1);

  // A bad signature is rejected.
  const forged = await processIssueWebhook(client, {
    rawBody,
    signature: "sha256=deadbeef",
    deliveryId: "delivery-forged",
    secret: SECRET,
  });
  assert.equal(forged.result, "invalid_signature");
  assert.equal(forged.status, 401);
});

test("a delivery received before its lever is durable and succeeds on exact retry", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;
  const payload = {
    action: "opened",
    issue: {
      number: 89,
      html_url: "https://github.com/acme/orbit/issues/89",
      state: "open",
      labels: [{ name: provenanceToken(DECISION) }],
      body: "the work",
    },
  };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`;
  const deliveryId = "delivery-before-lever";

  const queued = await processIssueWebhook(client, {
    rawBody,
    signature,
    deliveryId,
    secret: SECRET,
  });
  assert.equal(queued.result, "queued_retry");
  assert.equal(queued.status, 202);
  assert.equal((await client.from("transition_events").select("event_id", { count: "exact", head: true })
    .eq("source", "github").eq("provider_event_id", deliveryId)).count, 0);

  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);
  const retried = await processIssueWebhook(client, {
    rawBody,
    signature,
    deliveryId,
    secret: SECRET,
  });
  assert.equal(retried.result, "detected");
  assert.equal(await isAttributed(client), true);

  const inbox = await client.from("connector_webhook_inbox")
    .select("status, attempts, payload_digest")
    .eq("provider", "github")
    .eq("provider_event_id", deliveryId)
    .single();
  assert.equal(inbox.error, null, inbox.error?.message);
  assert.equal(inbox.data?.status, "processed");
  assert.equal(inbox.data?.attempts, 2);
  assert.match(String(inbox.data?.payload_digest), /^[0-9a-f]{64}$/);
  assert.equal((await client.from("transition_events").select("event_id", { count: "exact", head: true })
    .eq("source", "github").eq("provider_event_id", deliveryId)).count, 1);

  const changedBody = JSON.stringify({ ...payload, action: "reopened" });
  const changedSignature = `sha256=${createHmac("sha256", SECRET).update(changedBody, "utf8").digest("hex")}`;
  const changed = await processIssueWebhook(client, {
    rawBody: changedBody,
    signature: changedSignature,
    deliveryId,
    secret: SECRET,
  });
  assert.equal(changed.result, "payload_conflict");
  assert.equal(changed.status, 409);
});

test("a signed GitHub delivery cannot attribute a token from another repository", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;
  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);

  const payload = {
    action: "opened",
    repository: { full_name: "other/private-repo" },
    issue: {
      number: 90,
      html_url: "https://github.com/other/private-repo/issues/90",
      state: "open",
      labels: [{ name: provenanceToken(DECISION) }],
      body: "the work",
    },
  };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`;
  const outcome = await processIssueWebhook(client, {
    rawBody,
    signature,
    deliveryId: "delivery-wrong-repository",
    secret: SECRET,
  });
  assert.equal(outcome.result, "queued_retry");
  assert.equal(await isAttributed(client), false);
  assert.equal((await client.from("transition_events").select("event_id", { count: "exact", head: true })
    .eq("source", "github").eq("provider_event_id", "delivery-wrong-repository")).count, 0);
});

// ============================================================================
// 3. reconciliation cron detects a lever whose webhook was missed (poll MOCKED)
// ============================================================================
test("reconcile detects a missed lever via the mocked poll", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);
  assert.equal(await isAttributed(client), false);

  // Poller "finds" the issue the missed webhook would have reported.
  const poller: LeverPoller = {
    async findIssueForToken(repo, token) {
      assert.equal(repo, "acme/orbit");
      assert.equal(token, provenanceToken(DECISION));
      return { number: 99, htmlUrl: "https://github.com/acme/orbit/issues/99" };
    },
  };
  const out = await reconcileLevers(client, poller, { scopeId: WS, now: new Date("2026-07-12T00:00:00Z") });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.result.detected.length, 1);
    assert.equal(out.result.timedOut.length, 0);
  }
  assert.equal(await isAttributed(client), true, "reconcile attributes the missed lever");
});

// ============================================================================
// 4. detection timeout → TIMED_OUT
// ============================================================================
test("stale draft times out to TIMED_OUT", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  const drafted = await draftLeverFromDecision(client, WS, draftInput());
  assert.equal(drafted.ok, true);

  // A poll that never finds anything; `now` far past the draft + timeout window.
  const nullPoller: LeverPoller = { async findIssueForToken() { return null; } };
  const future = new Date(Date.now() + 60 * 86_400_000); // 60 days later
  const out = await reconcileLevers(client, nullPoller, { scopeId: WS, now: future, timeoutDays: 14 });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.result.detected.length, 0);
    assert.equal(out.result.timedOut.length, 1);
  }

  const row = await client.from("levers").select("status").eq("provenance_token", drafted.token).single();
  assert.equal((row.data as { status: string }).status, "TIMED_OUT");
  assert.equal(await isAttributed(client), false, "a timed-out draft never attributes");
});

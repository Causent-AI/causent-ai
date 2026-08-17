// Integration gate for Jira parity + write-scope auto-create (#19), against the
// LOCAL Supabase stack in a scratch tenant (created + torn down here). Skips
// honestly when the stack isn't reachable. Proves, with NO tracker credentials
// (a MOCK IssueCreator stands in for the live write API):
//
//   1. Jira read-only: draft(jira) → the user creates it → paste /browse/KEY →
//      description/label scan detects the token → attributed. actions.source and
//      levers.target_source are 'jira'.
//   2. Jira webhook: a created event (token in description) detects; a redelivery
//      of the same event dedups; a Done+Won't-Do update records a LEVER_DROPPED
//      transition (the drift signal).
//   3. Write-scope auto-create (GitHub AND Jira): with a write grant the lever is
//      created + attributed with ZERO user steps, via the issue-property (Jira) /
//      label (GitHub) strategy — and a re-run never creates a duplicate ticket.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { draftLeverFromDecision } from "../draft.ts";
import { autoCreateLever } from "../autocreate.ts";
import { processJiraWebhook } from "../jira-webhook.ts";
import { provenanceToken } from "../../connectors/github.ts";
import { jiraIssueExternalRef, parseJiraIssueUrl } from "../../connectors/jira.ts";
import { markLeverCreated, detectLever } from "../detect.ts";
import type { CreatedIssue, IssueCreator } from "../../connectors/write.ts";

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
const JIRA_SECRET = "test-jira-secret";

// Scratch tenant (namespaced 'c6' for cold-start C6; teardown exact).
const ORG = "c6c60000-0000-0000-0000-0000000000a0";
const PROJ = "c6c60000-0000-0000-0000-0000000000a1";
const WS = "c6c60000-0000-0000-0000-0000000000a2";
const METRIC = "c6c60000-0000-0000-0000-0000000000a3";
const DECISION = "c6c60000-0000-0000-0000-0000000000a4";
const PREDICTION = "c6c60000-0000-0000-0000-0000000000a5";

let sb: SupabaseClient | null = null;
let available = false;

async function teardown(client: SupabaseClient) {
  // Unresolved/quarantined deliveries can intentionally have no scope FK yet,
  // so deleting the scratch tenant alone cannot remove them. Clear this
  // fixture's deterministic token explicitly to keep each test isolated.
  const inbox = await client
    .from("connector_webhook_inbox")
    .delete()
    .eq("provider", "jira")
    .eq("provenance_token", provenanceToken(DECISION));
  assert.equal(inbox.error, null, inbox.error?.message);
  const result = await client.from("orgs").delete().eq("org_id", ORG); // cascades the tenant
  assert.equal(result.error, null, result.error?.message);
}

async function seedTenant(client: SupabaseClient) {
  const org = await client.from("orgs").insert({ org_id: ORG, name: "C6_TEST_org" });
  assert.equal(org.error, null, org.error?.message);
  const project = await client.from("projects").insert({ project_id: PROJ, org_id: ORG, name: "p" });
  assert.equal(project.error, null, project.error?.message);
  const workspace = await client.from("workspaces").insert({ workspace_id: WS, project_id: PROJ, name: "w" });
  assert.equal(workspace.error, null, workspace.error?.message);
  const metric = await client.from("metrics").insert({ metric_id: METRIC, scope_id: WS, name: "Activation", source: "declared" });
  assert.equal(metric.error, null, metric.error?.message);
  const decision = await client.from("decisions").insert({ decision_id: DECISION, scope_id: WS, title: "New onboarding checklist" });
  assert.equal(decision.error, null, decision.error?.message);
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

async function isAttributed(client: SupabaseClient): Promise<boolean> {
  const res = await client
    .from("levers")
    .select("status, action:actions(external_ref)")
    .eq("decision_id", DECISION);
  const rows = (res.data ?? []) as unknown as Array<{ status: string; action: { external_ref: string | null } | null }>;
  return rows.some((r) => (r.status === "DETECTED" || r.status === "SHIPPED") && r.action?.external_ref);
}

function jiraDraftInput() {
  return {
    decisionId: DECISION,
    metricId: METRIC,
    targetSource: "jira" as const,
    jira: { projectKey: "ORB", baseUrl: "https://acme.atlassian.net", projectId: "10001", issueTypeId: "10002" },
    title: "Ship the onboarding checklist",
    body: "Add a 3-step first-run checklist.",
  };
}

/** A mock write API: records how many tickets it created and returns a canned one. */
function mockCreator(created: CreatedIssue): { creator: IssueCreator; count: () => number } {
  let n = 0;
  const creator: IssueCreator = {
    async create() {
      n += 1;
      return created;
    },
  };
  return { creator, count: () => n };
}

test("new Jira drafts require an explicit site binding before database access", async () => {
  const result = await draftLeverFromDecision(
    null as unknown as SupabaseClient,
    WS,
    {
      ...jiraDraftInput(),
      jira: { ...jiraDraftInput().jira, baseUrl: "" },
    },
  );
  assert.deepEqual(result, { ok: false, error: "Jira target needs a site URL." });
});

// ============================================================================
// 1. Jira read-only: draft → paste → scan-detect → attributed
// ============================================================================
test("Jira read-only: draft → paste-URL scan detects and attributes", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  assert.equal(await isAttributed(client), false);

  const drafted = await draftLeverFromDecision(client, WS, jiraDraftInput());
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;
  assert.ok(drafted.deepLink?.includes("CreateIssueDetails"), "jira deep-link built");

  // The early actions row: source 'jira', target_source 'jira', external_ref NULL.
  const afterDraft = await client
    .from("levers")
    .select("status, target_source, action:actions(external_ref, source)")
    .eq("provenance_token", provenanceToken(DECISION))
    .single();
  const dr = afterDraft.data as unknown as {
    status: string;
    target_source: string;
    action: { external_ref: string | null; source: string };
  };
  assert.equal(dr.status, "DRAFTED");
  assert.equal(dr.target_source, "jira");
  assert.equal(dr.action.source, "jira");
  assert.equal(dr.action.external_ref, null);

  // Paste the created Jira issue URL → parse KEY → detect.
  const url = "https://acme.atlassian.net/browse/ORB-42";
  const parsed = parseJiraIssueUrl(url);
  assert.ok(parsed);
  await markLeverCreated(client, drafted.token);
  const det = await detectLever(client, {
    token: drafted.token,
    externalRef: jiraIssueExternalRef(parsed!.key),
    htmlUrl: url,
  });
  assert.equal(det.ok, true);

  const afterDetect = await client
    .from("levers")
    .select("status, action:actions(external_ref)")
    .eq("provenance_token", drafted.token)
    .single();
  const de = afterDetect.data as unknown as { status: string; action: { external_ref: string | null } };
  assert.equal(de.status, "DETECTED");
  assert.equal(de.action.external_ref, "jira:issue:ORB-42");
  assert.equal(await isAttributed(client), true);
});

// ============================================================================
// 2. Jira webhook: created → detect; redelivery dedups; Won't-Do → DROPPED
// ============================================================================
test("Jira webhook detects; redelivery dedups; Won't-Do records LEVER_DROPPED", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  const drafted = await draftLeverFromDecision(client, WS, jiraDraftInput());
  assert.equal(drafted.ok, true);
  const token = provenanceToken(DECISION);

  const createdPayload = {
    timestamp: 1_700_000_000_000,
    webhookEvent: "jira:issue_created",
    issue: {
      id: "10050",
      key: "ORB-50",
      self: "https://acme.atlassian.net/rest/api/3/issue/10050",
      fields: { description: `the work\n\n${token}`, labels: [] },
    },
  };
  const rawCreated = JSON.stringify(createdPayload);

  const first = await processJiraWebhook(client, { rawBody: rawCreated, providedSecret: JIRA_SECRET, secret: JIRA_SECRET });
  assert.equal(first.result, "detected");
  assert.equal(await isAttributed(client), true);

  // Redelivery of the same event dedups (same (source, provider_event_id)).
  const dup = await processJiraWebhook(client, { rawBody: rawCreated, providedSecret: JIRA_SECRET, secret: JIRA_SECRET });
  assert.equal(dup.result, "duplicate");

  // A wrong secret is rejected.
  const forged = await processJiraWebhook(client, { rawBody: rawCreated, providedSecret: "nope", secret: JIRA_SECRET });
  assert.equal(forged.result, "invalid_secret");
  assert.equal(forged.status, 401);

  // Done + Won't Do → a LEVER_DROPPED transition is recorded (drift signal).
  const droppedPayload = {
    timestamp: 1_700_000_100_000,
    webhookEvent: "jira:issue_updated",
    issue: {
      id: "10050",
      key: "ORB-50",
      self: "https://acme.atlassian.net/rest/api/3/issue/10050",
      fields: {
        labels: [token],
        status: { statusCategory: { key: "done" } },
        resolution: { name: "Won't Do" },
      },
    },
  };
  const dropped = await processJiraWebhook(client, {
    rawBody: JSON.stringify(droppedPayload),
    providedSecret: JIRA_SECRET,
    secret: JIRA_SECRET,
  });
  assert.equal(dropped.result, "ignored_untracked_action"); // recorded, not a (re)detect
  const drop = await client
    .from("transition_events")
    .select("canonical")
    .eq("source", "jira")
    .eq("canonical", "LEVER_DROPPED");
  assert.equal((drop.data ?? []).length, 1, "a LEVER_DROPPED transition was recorded");
});

test("a valid Jira secret cannot attribute a known token from another site", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;
  const drafted = await draftLeverFromDecision(client, WS, jiraDraftInput());
  assert.equal(drafted.ok, true);
  const token = provenanceToken(DECISION);
  const payload = {
    timestamp: 1_700_000_200_000,
    webhookEvent: "jira:issue_created",
    issue: {
      id: "10051",
      key: "ORB-51",
      self: "https://other.atlassian.net/rest/api/3/issue/10051",
      fields: { description: `the work\n\n${token}`, labels: [] },
    },
  };
  const outcome = await processJiraWebhook(client, {
    rawBody: JSON.stringify(payload),
    providedSecret: JIRA_SECRET,
    secret: JIRA_SECRET,
  });
  assert.equal(outcome.result, "queued_retry");
  assert.equal(await isAttributed(client), false);
});

test("legacy Jira rows quarantine without retries, then process after an explicit site rebind", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;
  const input = jiraDraftInput();
  const drafted = await draftLeverFromDecision(client, WS, input);
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;

  // Simulate the shape left by the pre-target_origin release: the project and
  // provider are known, but neither the lever payload nor its action can prove
  // which Jira tenant owns that project key.
  const legacyLever = await client
    .from("levers")
    .update({
      target_origin: null,
      drafted_payload: {
        title: input.title,
        body: input.body,
        label: drafted.token,
        deep_link: null,
        target_source: "jira",
      },
    })
    .eq("lever_id", drafted.leverId)
    .eq("scope_id", WS)
    .select("action_id")
    .single();
  assert.equal(legacyLever.error, null, legacyLever.error?.message);
  const actionId = (legacyLever.data as { action_id: string }).action_id;
  const legacyAction = await client
    .from("actions")
    .update({
      rationale_richtext: {
        type: "doc",
        title: input.title,
        content: [{ type: "paragraph", content: [{ type: "text", text: input.body }] }],
        meta: {
          provenance_token: drafted.token,
          target_ref: "ORB",
          target_source: "jira",
        },
      },
    })
    .eq("action_id", actionId)
    .eq("scope_id", WS);
  assert.equal(legacyAction.error, null, legacyAction.error?.message);

  const payload = {
    timestamp: 1_700_000_300_000,
    webhookEvent: "jira:issue_created",
    issue: {
      id: "10052",
      key: "ORB-52",
      self: "https://acme.atlassian.net/rest/api/3/issue/10052",
      fields: { description: `the work\n\n${drafted.token}`, labels: [] },
    },
  };
  const params = {
    rawBody: JSON.stringify(payload),
    providedSecret: JIRA_SECRET,
    secret: JIRA_SECRET,
  };

  const first = await processJiraWebhook(client, params);
  assert.equal(first.status, 202);
  assert.equal(first.result, "quarantined");
  assert.equal(await isAttributed(client), false);

  const quarantined = await client
    .from("connector_webhook_inbox")
    .select("status, attempts, scope_id, lever_id, action_id, last_error, quarantined_at")
    .eq("provider", "jira")
    .eq("provenance_token", drafted.token)
    .single();
  assert.equal(quarantined.error, null, quarantined.error?.message);
  assert.deepEqual(
    {
      status: quarantined.data?.status,
      attempts: quarantined.data?.attempts,
      scopeId: quarantined.data?.scope_id,
      leverId: quarantined.data?.lever_id,
      actionId: quarantined.data?.action_id,
      lastError: quarantined.data?.last_error,
    },
    {
      status: "quarantined",
      attempts: 0,
      scopeId: WS,
      leverId: drafted.leverId,
      actionId,
      lastError: "LEGACY_JIRA_TARGET_ORIGIN_UNBOUND",
    },
  );
  assert.ok(quarantined.data?.quarantined_at);

  for (let delivery = 0; delivery < 6; delivery += 1) {
    const redelivery = await processJiraWebhook(client, params);
    assert.equal(redelivery.status, 202);
    assert.equal(redelivery.result, "quarantined");
  }
  const stillQuarantined = await client
    .from("connector_webhook_inbox")
    .select("status, attempts")
    .eq("provider", "jira")
    .eq("provenance_token", drafted.token)
    .single();
  assert.deepEqual(stillQuarantined.data, { status: "quarantined", attempts: 0 });
  const transitionsBeforeBinding = await client
    .from("transition_events")
    .select("provider_event_id", { count: "exact", head: true })
    .eq("source", "jira")
    .eq("action_id", actionId);
  assert.equal(transitionsBeforeBinding.count, 0);

  // Re-drafting the same decision/project/site is an explicit, scope-checked
  // compare-and-set from NULL. It does not create a second action or lever.
  const rebound = await draftLeverFromDecision(client, WS, input);
  assert.equal(rebound.ok, true);
  if (!rebound.ok) return;
  assert.equal(rebound.reused, true);
  assert.equal(rebound.leverId, drafted.leverId);
  const bound = await client
    .from("levers")
    .select("target_origin")
    .eq("lever_id", drafted.leverId)
    .single();
  assert.deepEqual(bound.data, { target_origin: "https://acme.atlassian.net" });

  const processed = await processJiraWebhook(client, params);
  assert.equal(processed.status, 200);
  assert.equal(processed.result, "detected");
  assert.equal(await isAttributed(client), true);
  const finalInbox = await client
    .from("connector_webhook_inbox")
    .select("status, attempts, quarantined_at, processed_at")
    .eq("provider", "jira")
    .eq("provenance_token", drafted.token)
    .single();
  assert.equal(finalInbox.data?.status, "processed");
  assert.equal(finalInbox.data?.attempts, 1);
  assert.equal(finalInbox.data?.quarantined_at, null);
  assert.ok(finalInbox.data?.processed_at);
});

// ============================================================================
// 3. Write-scope auto-create (GitHub + Jira): zero-click, idempotent
// ============================================================================
test("write-scope auto-create attributes with zero clicks and never duplicates (GitHub)", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  const { creator, count } = mockCreator({
    externalRef: "github:issue:501",
    url: "https://github.com/acme/orbit/issues/501",
    strategy: "label",
  });
  const input = {
    decisionId: DECISION,
    metricId: METRIC,
    targetSource: "github" as const,
    repo: "acme/orbit",
    title: "Ship it",
    body: "do the thing",
  };

  const first = await autoCreateLever(client, WS, input, creator);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.externalRef, "github:issue:501");
    assert.equal(first.alreadyCreated, false);
    assert.equal(first.strategy, "label");
  }
  assert.equal(await isAttributed(client), true, "auto-create attributes immediately");

  // Idempotent: a second call creates NO second ticket.
  const second = await autoCreateLever(client, WS, input, creator);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.alreadyCreated, true);
  assert.equal(count(), 1, "the tracker create API was called exactly once");
});

test("write-scope auto-create sets the issue-property strategy (Jira)", async (t) => {
  if (!available || !sb) return t.skip("local Supabase stack not reachable");
  const client = sb;

  const { creator } = mockCreator({
    externalRef: "jira:issue:ORB-77",
    url: "https://acme.atlassian.net/browse/ORB-77",
    strategy: "issue_property",
  });
  const out = await autoCreateLever(client, WS, jiraDraftInput(), creator);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.externalRef, "jira:issue:ORB-77");
    assert.equal(out.strategy, "issue_property");
  }
  assert.equal(await isAttributed(client), true);

  // The lever records the auto-create provenance (surfaces the fast lane).
  const lever = await client
    .from("levers")
    .select("drafted_payload, target_source")
    .eq("provenance_token", provenanceToken(DECISION))
    .single();
  const lp = lever.data as unknown as { drafted_payload: Record<string, unknown>; target_source: string };
  assert.equal(lp.target_source, "jira");
  assert.equal(lp.drafted_payload.auto_created, true);
  assert.equal(lp.drafted_payload.auto_create_strategy, "issue_property");
});

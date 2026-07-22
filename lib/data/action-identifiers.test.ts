import assert from "node:assert/strict";
import { test } from "node:test";

import { toActionIdentity } from "./action-identifiers.ts";

test("GitHub PR identities retain the existing a-<pr> deep link", () => {
  assert.deepEqual(toActionIdentity({
    action_id: "ca5e0000-0000-0000-0000-000000000001",
    source: "github_pr",
    external_ref: "PR #8421",
  }), {
    uiId: "a-8421",
    pr: 8421,
    source: "github",
    referenceLabel: "#8421",
  });
});

test("manual and Jira actions use collision-free UUID identities", () => {
  const manualId = "ca5e0000-0000-0000-0000-000000000002";
  const jiraId = "ca5e0000-0000-0000-0000-000000000003";
  const manual = toActionIdentity({
    action_id: manualId,
    source: "manual",
    external_ref: "decision-report:any-number-12",
  });
  const jira = toActionIdentity({
    action_id: jiraId,
    source: "jira",
    external_ref: "GUM-12",
  });
  assert.equal(manual.uiId, manualId);
  assert.equal(manual.referenceLabel, "Planned");
  assert.equal(jira.uiId, jiraId);
  assert.equal(jira.referenceLabel, "GUM-12");
});

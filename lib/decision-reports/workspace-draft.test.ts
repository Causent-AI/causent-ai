import assert from "node:assert/strict";
import test from "node:test";

import { reconcileWorkspaceDraft } from "./workspace-draft.ts";

test("keeps a generated draft when the server action moves into its workspace", () => {
  const draft = { workspaceId: "northstar", title: "Northstar report" };
  assert.equal(reconcileWorkspaceDraft(draft, "northstar"), draft);
});

test("discards a mounted draft when the header selects another workspace", () => {
  const draft = { workspaceId: "gummy", title: "Gummy report" };
  assert.equal(reconcileWorkspaceDraft(draft, "northstar"), null);
  assert.equal(reconcileWorkspaceDraft(null, "northstar"), null);
});

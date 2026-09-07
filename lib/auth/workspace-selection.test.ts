import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_SCOPE_ID,
  NORTHSTAR_SCOPE_ID,
} from "../data/config.ts";
import {
  mapAccessibleDemoWorkspaces,
  mapAccessibleWorkspaces,
  selectAccessibleWorkspaceId,
  selectDemoWorkspaceId,
  staticDemoWorkspaceOption,
} from "./workspace-selection.ts";

test("customer discovery retains arbitrary RLS-visible workspace identities", () => {
  const first = "1b7edfe4-a9ab-4cbe-967f-88bb079f1111";
  const second = "7b7edfe4-a9ab-4cbe-967f-88bb079f2222";
  assert.deepEqual(mapAccessibleWorkspaces([
    { workspace_id: second, name: "Support", projects: { name: "Customer B" } },
    { workspace_id: first, name: "Support", projects: { name: "Customer A" } },
  ]), [
    { id: first, project: "Customer A", workspace: "Support" },
    { id: second, project: "Customer B", workspace: "Support" },
  ]);
  assert.equal(selectAccessibleWorkspaceId(second, [first, second]), second);
  assert.equal(selectAccessibleWorkspaceId(second, [first]), first);
  assert.equal(selectAccessibleWorkspaceId({ id: second }, [second, first]), first);
  assert.equal(selectAccessibleWorkspaceId(first, []), null);
});

test("static seed mode exposes only the Gummy Alpha workspace", () => {
  assert.deepEqual(staticDemoWorkspaceOption(), {
    id: DEMO_SCOPE_ID,
    project: "Orbit",
    workspace: "Gummy Alpha",
  });
});

test("maps only registered database rows in deterministic registry order", () => {
  assert.deepEqual(
    mapAccessibleDemoWorkspaces([
      {
        workspace_id: NORTHSTAR_SCOPE_ID,
        name: "Support Operations",
        projects: { name: "Northstar" },
      },
      {
        workspace_id: "ca5e0000-0000-0000-0000-00000000ffff",
        name: "Forged",
        projects: { name: "Foreign" },
      },
      {
        workspace_id: DEMO_SCOPE_ID,
        name: "Gummy Alpha",
        projects: { name: "Orbit" },
      },
    ]),
    [
      { id: DEMO_SCOPE_ID, project: "Orbit", workspace: "Gummy Alpha" },
      { id: NORTHSTAR_SCOPE_ID, project: "Northstar", workspace: "Support Operations" },
    ],
  );
});

test("selects an exact registered workspace only when it is accessible", () => {
  assert.equal(
    selectDemoWorkspaceId(NORTHSTAR_SCOPE_ID, [DEMO_SCOPE_ID, NORTHSTAR_SCOPE_ID]),
    NORTHSTAR_SCOPE_ID,
  );
  assert.equal(
    selectDemoWorkspaceId(NORTHSTAR_SCOPE_ID, [DEMO_SCOPE_ID]),
    DEMO_SCOPE_ID,
  );
});

test("forged and malformed workspace values fall back deterministically", () => {
  assert.equal(
    selectDemoWorkspaceId("ca5e0000-0000-0000-0000-00000000ffff", [DEMO_SCOPE_ID]),
    DEMO_SCOPE_ID,
  );
  assert.equal(
    selectDemoWorkspaceId({ id: NORTHSTAR_SCOPE_ID }, [DEMO_SCOPE_ID]),
    DEMO_SCOPE_ID,
  );
});

test("fallback follows the server registry rather than caller-provided order", () => {
  assert.equal(
    selectDemoWorkspaceId(null, [NORTHSTAR_SCOPE_ID, DEMO_SCOPE_ID]),
    DEMO_SCOPE_ID,
  );
  assert.equal(
    selectDemoWorkspaceId(null, [NORTHSTAR_SCOPE_ID]),
    NORTHSTAR_SCOPE_ID,
  );
});

test("fails explicitly when no registered workspace is accessible", () => {
  assert.equal(selectDemoWorkspaceId(null, []), null);
  assert.equal(
    selectDemoWorkspaceId(DEMO_SCOPE_ID, ["ca5e0000-0000-0000-0000-00000000ffff"]),
    null,
  );
});

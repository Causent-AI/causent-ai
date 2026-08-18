import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_SCOPE_ID,
  NORTHSTAR_SCOPE_ID,
} from "../data/config.ts";
import {
  mapAccessibleDemoWorkspaces,
  selectDemoWorkspaceId,
  staticDemoWorkspaceOption,
} from "./workspace-selection.ts";

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

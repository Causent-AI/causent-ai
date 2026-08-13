import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFutureMcpCommandExample } from "./mcp-example.ts";

test("builds the explicitly illustrative current-action MCP command", () => {
  assert.equal(
    buildFutureMcpCommandExample("Gummy Alpha", "D1A1"),
    '/causent pull context -project "Gummy Alpha" -task D1A1',
  );
  assert.equal(
    buildFutureMcpCommandExample("Project", "d2a25"),
    '/causent pull context -project "Project" -task D2A25',
  );
});

test("normalizes and bounds project copy without allowing quote or control injection", () => {
  assert.equal(
    buildFutureMcpCommandExample('  Acme\n" -task D9A9 \\ Labs  ', "D1A2"),
    '/causent pull context -project "Acme -task D9A9 Labs" -task D1A2',
  );
  const command = buildFutureMcpCommandExample("😀".repeat(200), "D1A1");
  assert.ok(command);
  assert.equal(Array.from(command.match(/-project "(.*)" -task/u)?.[1] ?? "").length, 120);
});

test("uses an honest placeholder for an empty project and rejects untrusted task coordinates", () => {
  assert.equal(
    buildFutureMcpCommandExample("\u0000\n", "D1A1"),
    '/causent pull context -project "Project Name" -task D1A1',
  );
  assert.equal(buildFutureMcpCommandExample("Project", "Action"), null);
  assert.equal(buildFutureMcpCommandExample("Project", "D1A1\n/ship"), null);
  assert.equal(buildFutureMcpCommandExample("Project", undefined), null);
});

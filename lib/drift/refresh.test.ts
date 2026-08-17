import assert from "node:assert/strict";
import { test } from "node:test";

import { kickDriftRefresh, parseDriftRefreshSummary } from "./refresh.ts";

const URL = "https://worker.example/drift";
const SECRET = "test-secret";
const SCOPE = "ca5e0000-0000-0000-0000-000000000071";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    processed: 1,
    superseded: 0,
    retry_scheduled: 0,
    failed: 0,
    total: 1,
    results: [
      {
        scope_id: SCOPE,
        generation: 1,
        status: "PROCESSED",
        detail: "current drift materialized",
      },
    ],
    truncated: false,
    ...overrides,
  };
}

test("unconfigured refresh defers without throwing", async () => {
  assert.deepEqual(await kickDriftRefresh({}, { url: "", secret: "" }), {
    ok: false,
    configured: false,
    error: "not_configured",
  });
});

test("kick sends only bounded queue filters and private secret", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await kickDriftRefresh(
    { scopeId: SCOPE, limit: 1 },
    {
      url: URL,
      secret: SECRET,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify(summary()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, URL);
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["x-causent-drift-secret"],
    SECRET,
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    scope_id: SCOPE,
    limit: 1,
  });
});

test("summary parser is exact, internally consistent, and bounded", () => {
  assert.notEqual(parseDriftRefreshSummary(summary()), null);
  assert.equal(parseDriftRefreshSummary({ ...summary(), unexpected: true }), null);
  assert.equal(parseDriftRefreshSummary(summary({ total: 2 })), null);
  assert.equal(parseDriftRefreshSummary(summary({ ok: false })), null);
  assert.equal(parseDriftRefreshSummary(summary({ results: [] })), null);
  assert.equal(parseDriftRefreshSummary(summary({
    results: [{ scope_id: "forged", generation: 1, status: "PROCESSED", detail: "x" }],
  })), null);
});

test("network, response, and terminal failures remain non-success", async () => {
  const unreachable = await kickDriftRefresh({}, {
    url: URL,
    secret: SECRET,
    fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
  });
  assert.deepEqual(unreachable, {
    ok: false,
    configured: true,
    error: "unreachable",
  });

  const invalid = await kickDriftRefresh({}, {
    url: URL,
    secret: SECRET,
    fetchImpl: (async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
    })) as typeof fetch,
  });
  assert.deepEqual(invalid, {
    ok: false,
    configured: true,
    error: "invalid_response",
    status: 200,
  });

  const terminal = await kickDriftRefresh({}, {
    url: URL,
    secret: SECRET,
    fetchImpl: (async () => new Response(JSON.stringify(summary({
      ok: false,
      processed: 0,
      failed: 1,
      results: [
        { scope_id: SCOPE, generation: 8, status: "FAILED", detail: "RuntimeError" },
      ],
    })), { status: 500 })) as typeof fetch,
  });
  assert.deepEqual(terminal, {
    ok: false,
    configured: true,
    error: "terminal_failure",
    status: 500,
    summary: { failed: 1, retryScheduled: 0, total: 1 },
  });
});

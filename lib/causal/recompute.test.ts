import assert from "node:assert/strict";
import { test } from "node:test";

import {
  kickCausalRecompute,
  parseCausalRecomputeSummary,
} from "./recompute.ts";

const URL = "https://worker.example/recompute";
const SECRET = "test-secret";
const ACTIVATION = "ca5e0000-0000-0000-0000-000000000075";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    processed: 1,
    unchanged: 0,
    superseded: 0,
    retry_scheduled: 0,
    failed: 0,
    total: 1,
    results: [
      {
        activation_id: ACTIVATION,
        generation: 1,
        status: "PROCESSED",
        detail: "graph materialized",
      },
    ],
    truncated: false,
    ...overrides,
  };
}

test("unconfigured kicks defer without throwing", async () => {
  assert.deepEqual(await kickCausalRecompute({}, { url: "", secret: "" }), {
    ok: false,
    configured: false,
    error: "not_configured",
  });
});

test("kick sends only queue filters and the private secret header", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await kickCausalRecompute(
    {
      scopeId: "ca5e0000-0000-0000-0000-000000000071",
      metricId: "ca5e0000-0000-0000-0000-000000000073",
      limit: 1,
    },
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
  assert.equal((calls[0].init.headers as Record<string, string>)["x-causent-recompute-secret"], SECRET);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    scope_id: "ca5e0000-0000-0000-0000-000000000071",
    metric_id: "ca5e0000-0000-0000-0000-000000000073",
    limit: 1,
  });
});

test("worker summaries are exact, internally consistent, and bounded", () => {
  assert.notEqual(parseCausalRecomputeSummary(summary()), null);
  assert.equal(parseCausalRecomputeSummary({ ...summary(), unexpected: true }), null);
  assert.equal(parseCausalRecomputeSummary(summary({ total: 2 })), null);
  assert.equal(parseCausalRecomputeSummary(summary({ ok: false })), null);
  assert.equal(
    parseCausalRecomputeSummary(
      summary({
        results: [
          {
            activation_id: "forged",
            generation: 1,
            status: "PROCESSED",
            detail: "graph materialized",
          },
        ],
      }),
    ),
    null,
  );
});

test("network and worker failures become deferred results", async () => {
  const unreachable = await kickCausalRecompute({}, {
    url: URL,
    secret: SECRET,
    fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
  });
  assert.deepEqual(unreachable, { ok: false, configured: true, error: "unreachable" });

  const rejected = await kickCausalRecompute({}, {
    url: URL,
    secret: SECRET,
    fetchImpl: (async () => new Response("no", { status: 503 })) as typeof fetch,
  });
  assert.deepEqual(rejected, {
    ok: false,
    configured: true,
    error: "rejected",
    status: 503,
  });

  const invalid = await kickCausalRecompute({}, {
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
});

test("terminal worker failures stay non-success even with a structured body", async () => {
  const result = await kickCausalRecompute({}, {
    url: URL,
    secret: SECRET,
    fetchImpl: (async () => new Response(JSON.stringify(summary({
      ok: false,
      processed: 0,
      failed: 1,
      results: [
        {
          activation_id: ACTIVATION,
          generation: 8,
          status: "FAILED",
          detail: "RuntimeError",
        },
      ],
    })), { status: 500 })) as typeof fetch,
  });
  assert.deepEqual(result, {
    ok: false,
    configured: true,
    error: "terminal_failure",
    status: 500,
    summary: { failed: 1, retryScheduled: 0, total: 1 },
  });
});

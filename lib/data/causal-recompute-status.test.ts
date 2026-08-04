import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadCurrentCausalRecomputeStatus,
  parseCausalRecomputeStatusRow,
} from "./causal-recompute-status.ts";

test("causal recompute status parser accepts only sanitized public states", () => {
  assert.deepEqual(parseCausalRecomputeStatusRow({
    status: "retrying",
    requested_at: "2026-07-23T12:00:00Z",
    last_processed_at: null,
    next_attempt_at: "2026-07-23T12:05:00Z",
  }), {
    state: "retrying",
    requestedAt: "2026-07-23T12:00:00Z",
    lastProcessedAt: null,
    nextAttemptAt: "2026-07-23T12:05:00Z",
  });
  assert.throws(() => parseCausalRecomputeStatusRow({
    status: "processing-secret-error",
    requested_at: null,
    last_processed_at: null,
    next_attempt_at: null,
  }));
});

test("causal recompute repository returns null when no current activation exists", async () => {
  const sb = {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "get_current_causal_recompute_status_v1");
      assert.deepEqual(args, { p_scope_id: "scope" });
      return { data: [], error: null };
    },
  };
  assert.equal(
    await loadCurrentCausalRecomputeStatus(sb as never, "scope"),
    null,
  );
});

test("causal recompute repository fails loudly on RPC errors or ambiguous rows", async () => {
  const denied = {
    async rpc() {
      return { data: null, error: new Error("denied") };
    },
  };
  await assert.rejects(
    loadCurrentCausalRecomputeStatus(denied as never, "scope"),
    /denied/,
  );

  const ambiguous = {
    async rpc() {
      const row = {
        status: "idle",
        requested_at: null,
        last_processed_at: null,
        next_attempt_at: null,
      };
      return { data: [row, row], error: null };
    },
  };
  await assert.rejects(
    loadCurrentCausalRecomputeStatus(ambiguous as never, "scope"),
    /Ambiguous/,
  );
});

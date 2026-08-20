import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadDecisionReportRolloutState,
  resolveOnboardingFlow,
} from "./rollout.ts";

const SCOPE_ID = "ca5e0000-0000-0000-0000-0000000000d3";
const USER_ID = "ca5e1111-0000-0000-0000-0000000000d9";

test("unassigned authenticated starts use the current Decision Report flow", () => {
  assert.equal(resolveOnboardingFlow({
    requestedFlow: null,
    hasSavedReport: false,
    rolloutState: "unassigned",
  }), "decision-report");
});

test("enabled new starts use Decision Report", () => {
  assert.equal(resolveOnboardingFlow({
    requestedFlow: null,
    hasSavedReport: false,
    rolloutState: "enabled",
  }), "decision-report");
});

test("a stale legacy URL is promoted when rollout is enabled or unassigned", () => {
  for (const rolloutState of ["enabled", "unassigned"] as const) {
    assert.equal(resolveOnboardingFlow({
      requestedFlow: "legacy",
      hasSavedReport: false,
      rolloutState,
    }), "decision-report");
  }
});

test("disabling rollout sends an unsaved Decision Report start to legacy", () => {
  assert.equal(resolveOnboardingFlow({
    requestedFlow: "decision-report",
    hasSavedReport: false,
    rolloutState: "disabled",
  }), "legacy");
});

test("lookup failures fail closed for unsaved starts", () => {
  assert.equal(resolveOnboardingFlow({
    requestedFlow: "decision-report",
    hasSavedReport: false,
    rolloutState: "unavailable",
  }), "legacy");
});

test("saved reports survive rollback and lookup failures", () => {
  for (const rolloutState of ["disabled", "unavailable"] as const) {
    assert.equal(resolveOnboardingFlow({
      requestedFlow: "legacy",
      hasSavedReport: true,
      rolloutState,
    }), "decision-report");
  }
});

type FakeRolloutResult = {
  data: { enabled: boolean } | null;
  error: { code: string; message: string } | null;
};

function fakeRolloutClient(result: FakeRolloutResult | Error): SupabaseClient {
  const predicates: Array<[string, string]> = [];
  const query = {
    select(columns: string) {
      assert.equal(columns, "enabled");
      return query;
    },
    eq(column: string, value: string) {
      predicates.push([column, value]);
      return query;
    },
    async maybeSingle() {
      assert.deepEqual(predicates, [
        ["scope_id", SCOPE_ID],
        ["user_id", USER_ID],
      ]);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return {
    from(table: string) {
      assert.equal(table, "decision_report_rollouts");
      return query;
    },
  } as unknown as SupabaseClient;
}

test("rollout lookup distinguishes enabled, disabled, and unassigned rows", async () => {
  assert.equal(await loadDecisionReportRolloutState(
    fakeRolloutClient({ data: { enabled: true }, error: null }),
    SCOPE_ID,
    USER_ID,
  ), "enabled");
  assert.equal(await loadDecisionReportRolloutState(
    fakeRolloutClient({ data: { enabled: false }, error: null }),
    SCOPE_ID,
    USER_ID,
  ), "disabled");
  assert.equal(await loadDecisionReportRolloutState(
    fakeRolloutClient({ data: null, error: null }),
    SCOPE_ID,
    USER_ID,
  ), "unassigned");
});

test("anonymous local demo remains gated by its explicit flag", async () => {
  const unusedClient = fakeRolloutClient(new Error("must not query"));
  assert.equal(await loadDecisionReportRolloutState(
    unusedClient,
    SCOPE_ID,
    null,
    false,
  ), "disabled");
  assert.equal(await loadDecisionReportRolloutState(
    unusedClient,
    SCOPE_ID,
    null,
    true,
  ), "enabled");
});

test("rollout lookup failures become unavailable without logging user PII", async () => {
  const originalConsoleError = console.error;
  const logCalls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logCalls.push(args);
  };

  try {
    assert.equal(await loadDecisionReportRolloutState(
      fakeRolloutClient({
        data: null,
        error: { code: "PGRST_TEST", message: `failed for ${USER_ID}` },
      }),
      SCOPE_ID,
      USER_ID,
    ), "unavailable");
    assert.equal(await loadDecisionReportRolloutState(
      fakeRolloutClient(new Error(`network failed for ${USER_ID}`)),
      SCOPE_ID,
      USER_ID,
    ), "unavailable");
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logCalls.length, 2);
  assert.equal(JSON.stringify(logCalls).includes(USER_ID), false);
  assert.equal(resolveOnboardingFlow({
    requestedFlow: null,
    hasSavedReport: false,
    rolloutState: "unavailable",
  }), "legacy");
});

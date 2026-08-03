import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createDecisionReportFunnelSessionKey,
  getDecisionReportFunnelMetrics,
  recordDecisionReportFunnelEvent,
  recordFunnelEvent,
  type RecordDecisionReportFunnelEventInput,
} from "./funnel.ts";
import { recordDecisionReportTelemetry } from "../decision-reports/telemetry.ts";

function writeClient(
  writes: Array<Record<string, unknown>>,
  error: { message: string } | null = null,
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "funnel_events");
      return {
        async insert(row: Record<string, unknown>) {
          writes.push(row);
          return { error };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const validInput: RecordDecisionReportFunnelEventInput = {
  sessionKey: "dr-01234567-89ab-4def-8123-456789abcdef",
  eventType: "REPORT_EDITABLE",
  msSinceStart: 1_250,
  meta: {
    editCount: 3,
    followUpCount: 1,
    missingFieldCount: 2,
    usedUrl: true,
    usedPdf: false,
    usedFallback: false,
    reused: false,
  },
};

test("Decision Report telemetry writes only the bounded allowlist", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const result = await recordDecisionReportFunnelEvent(
    writeClient(writes),
    "workspace-id",
    "user-id",
    validInput,
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    scope_id: "workspace-id",
    user_id: "user-id",
    session_key: "dr-01234567-89ab-4def-8123-456789abcdef",
    event_type: "REPORT_EDITABLE",
    step: null,
    ms_since_start: 1_250,
    meta: validInput.meta,
  });
});

test("Decision Report telemetry rejects unknown, textual, nested, and oversized metadata before IO", async () => {
  const invalidMeta: unknown[] = [
    { prompt: "private report body" },
    { editCount: "3" },
    { followUpCount: { count: 1 } },
    { missingFieldCount: -1 },
    { editCount: 10_001 },
    { usedUrl: 1 },
    ["not", "an", "object"],
  ];

  for (const meta of invalidMeta) {
    const writes: Array<Record<string, unknown>> = [];
    const result = await recordDecisionReportFunnelEvent(
      writeClient(writes),
      "workspace-id",
      null,
      { ...validInput, meta } as RecordDecisionReportFunnelEventInput,
    );
    assert.equal(result.ok, false, JSON.stringify(meta));
    assert.equal(writes.length, 0, JSON.stringify(meta));
  }
});

test("Decision Report telemetry requires an opaque session key and bounded elapsed integer", async () => {
  const invalidInputs: RecordDecisionReportFunnelEventInput[] = [
    { ...validInput, sessionKey: "report title supplied by user" },
    { ...validInput, sessionKey: "dr-short" },
    { ...validInput, msSinceStart: -1 },
    { ...validInput, msSinceStart: 1.5 },
    { ...validInput, msSinceStart: 8 * 24 * 60 * 60 * 1_000 },
  ];

  for (const input of invalidInputs) {
    const writes: Array<Record<string, unknown>> = [];
    const result = await recordDecisionReportFunnelEvent(
      writeClient(writes),
      "workspace-id",
      null,
      input,
    );
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(writes.length, 0, JSON.stringify(input));
  }
});

test("Decision Report telemetry session keys are content-free UUIDs", () => {
  assert.match(
    createDecisionReportFunnelSessionKey(),
    /^dr-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("the legacy writer cannot bypass Decision Report metadata validation", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const result = await recordFunnelEvent(writeClient(writes), "workspace-id", null, {
    sessionKey: validInput.sessionKey,
    eventType: "REPORT_SAVED",
    meta: { reportBody: "must not be written" },
  });

  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});

test("Decision Report metric repository filters event types and folds returned rows", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rows = [
    {
      session_key: "dr-01234567-89ab-4def-8123-456789abcdef",
      event_type: "REPORT_LANDED",
      step: null,
      ms_since_start: 0,
      meta: null,
    },
    {
      session_key: "dr-01234567-89ab-4def-8123-456789abcdef",
      event_type: "REPORT_EDITABLE",
      step: null,
      ms_since_start: 2_000,
      meta: { editCount: 2 },
    },
  ];
  const query = {
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return query;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return query;
    },
    async in(...args: unknown[]) {
      calls.push({ method: "in", args });
      return { data: rows, error: null };
    },
  };
  const client = {
    from(table: string) {
      assert.equal(table, "funnel_events");
      return query;
    },
  } as unknown as SupabaseClient;

  const metrics = await getDecisionReportFunnelMetrics(client, "workspace-id");
  assert.equal(metrics.distinctSessions, 1);
  assert.equal(metrics.stageCounts.landed, 1);
  assert.equal(metrics.stageCounts.editable, 1);
  assert.deepEqual(metrics.timingMs.timeToEditable, {
    sampledSessions: 1,
    median: 2_000,
  });
  assert.deepEqual(calls.map((call) => call.method), ["select", "eq", "in"]);
  assert.deepEqual(calls[1].args, ["scope_id", "workspace-id"]);
  assert.equal(calls[2].args[0], "event_type");
});

test("best-effort Decision Report telemetry never rejects the product flow", async () => {
  const throwingClient = {
    from() {
      throw new Error("telemetry database unavailable");
    },
  } as unknown as SupabaseClient;

  await assert.doesNotReject(() => recordDecisionReportTelemetry(
    { client: throwingClient, scopeId: "workspace-id", userId: null },
    validInput,
  ));

  const writes: Array<Record<string, unknown>> = [];
  await recordDecisionReportTelemetry(
    { client: writeClient(writes, { message: "rejected" }), scopeId: "workspace-id", userId: null },
    validInput,
  );
  assert.equal(writes.length, 1);
});

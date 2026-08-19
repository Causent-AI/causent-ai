import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listProductionResolutionTargets,
  mapWithConcurrency,
  MAX_RESOLUTION_WORKSPACES,
  resolutionDayForCron,
  resolutionWorkerPayload,
  ResolutionScopeDiscoveryError,
} from "./cron-scopes.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const WORKSPACE = "30000000-0000-4000-8000-000000000001";
const MEMBER = "40000000-0000-4000-8000-000000000001";
const ADMIN = "40000000-0000-4000-8000-000000000002";

test("worker payload carries the server-selected production actor and preserves demo omission", () => {
  assert.deepEqual(
    resolutionWorkerPayload(WORKSPACE, MEMBER, "2026-08-18"),
    { scope_id: WORKSPACE, user_id: MEMBER, today: "2026-08-18" },
  );
  assert.deepEqual(
    resolutionWorkerPayload(WORKSPACE, undefined, undefined),
    { scope_id: WORKSPACE },
  );
});

test("frequent cron runs retain the 15:00 UTC resolution-day cutoff", async () => {
  assert.equal(resolutionDayForCron(new Date("2026-08-18T14:59:59Z")), "2026-08-17");
  assert.equal(resolutionDayForCron(new Date("2026-08-18T15:00:00Z")), "2026-08-18");
  assert.equal(resolutionDayForCron(new Date("2027-01-01T00:00:00Z")), "2026-12-31");
  assert.throws(() => resolutionDayForCron(new Date("invalid")), RangeError);

  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  ) as { crons?: Array<{ path?: string; schedule?: string }> };
  assert.equal(
    vercel.crons?.find((cron) => cron.path === "/api/cron/resolve")?.schedule,
    "*/5 * * * *",
  );
});

type QueryResponse = { data: unknown[] | null; error: { message: string } | null };

function query(response: QueryResponse, calls: string[]) {
  const builder = {
    select(value: string) { calls.push(`select:${value}`); return builder; },
    is(column: string, value: unknown) { calls.push(`is:${column}:${String(value)}`); return builder; },
    lte(column: string, value: unknown) { calls.push(`lte:${column}:${String(value)}`); return builder; },
    eq(column: string, value: unknown) { calls.push(`eq:${column}:${String(value)}`); return builder; },
    in(column: string, value: unknown[]) { calls.push(`in:${column}:${value.join(",")}`); return builder; },
    or(value: string) { calls.push(`or:${value}`); return builder; },
    order(column: string) { calls.push(`order:${column}`); return builder; },
    limit(value: number, options?: { referencedTable?: string }) {
      calls.push(`limit:${value}:${options?.referencedTable ?? "root"}`);
      return builder;
    },
    then(resolve: (value: QueryResponse) => unknown) { return Promise.resolve(response).then(resolve); },
  };
  return builder;
}

function client(responses: QueryResponse[], calls: string[]): SupabaseClient {
  let index = 0;
  return {
    from(table: string) {
      calls.push(`from:${table}`);
      const response = responses[index];
      index += 1;
      if (!response) throw new Error(`unexpected query ${table}`);
      return query(response, calls);
    },
  } as unknown as SupabaseClient;
}

test("production discovery selects a real write-capable actor and mirrors inherited scope grants", async () => {
  const calls: string[] = [];
  const sb = client([
    {
      data: [{ workspace_id: WORKSPACE, project_id: PROJECT, projects: { org_id: ORG } }],
      error: null,
    },
    {
      data: [
        { user_id: ADMIN, org_id: ORG, project_id: PROJECT, workspace_id: null, role: "admin", created_at: "2026-01-01" },
        { user_id: MEMBER, org_id: ORG, project_id: null, workspace_id: null, role: "member", created_at: "2026-02-01" },
        { user_id: "not-a-uuid", org_id: ORG, project_id: PROJECT, workspace_id: WORKSPACE, role: "owner" },
      ],
      error: null,
    },
  ], calls);

  const batch = await listProductionResolutionTargets(sb, "2026-08-18");

  assert.deepEqual(batch, {
    targets: [{ scopeId: WORKSPACE, userId: MEMBER }],
    truncated: false,
  });
  assert.ok(calls.includes("from:workspaces"));
  assert.ok(calls.includes(`limit:${MAX_RESOLUTION_WORKSPACES + 1}:root`));
  assert.ok(calls.includes("limit:1:predictions"));
  assert.ok(calls.includes(`eq:org_id:${ORG}`));
  assert.ok(calls.some((call) => call.startsWith("or:and(project_id.is.null")));
});

test("viewer-only or cross-workspace identities fail closed without returning a scope", async () => {
  const sb = client([
    {
      data: [{ workspace_id: WORKSPACE, project_id: PROJECT, projects: [{ org_id: ORG }] }],
      error: null,
    },
    {
      data: [
        { user_id: MEMBER, org_id: ORG, project_id: PROJECT, workspace_id: WORKSPACE, role: "viewer" },
        { user_id: ADMIN, org_id: ORG, project_id: PROJECT, workspace_id: "30000000-0000-4000-8000-000000000099", role: "admin" },
      ],
      error: null,
    },
  ], []);

  await assert.rejects(
    listProductionResolutionTargets(sb, "2026-08-18"),
    (error: unknown) => error instanceof ResolutionScopeDiscoveryError
      && error.code === "no_eligible_actor"
      && !error.message.includes(WORKSPACE),
  );
});

test("due-workspace query failures and malformed hierarchy rows expose only a generic error", async () => {
  const failed = client([{ data: null, error: { message: `secret ${WORKSPACE}` } }], []);
  await assert.rejects(
    listProductionResolutionTargets(failed, "2026-08-18"),
    (error: unknown) => error instanceof ResolutionScopeDiscoveryError
      && error.code === "due_workspace_query_failed"
      && error.message === "Resolution scope discovery failed.",
  );

  const malformed = client([{
    data: [{ workspace_id: WORKSPACE, project_id: PROJECT, projects: null }],
    error: null,
  }], []);
  await assert.rejects(
    listProductionResolutionTargets(malformed, "2026-08-18"),
    (error: unknown) => error instanceof ResolutionScopeDiscoveryError
      && error.code === "invalid_scope_row",
  );
});

test("production discovery caps workspace enumeration and reports continuation", async () => {
  const rows = Array.from({ length: MAX_RESOLUTION_WORKSPACES + 1 }, (_, index) => ({
    workspace_id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    project_id: PROJECT,
    projects: { org_id: ORG },
  }));
  const actorResponses = Array.from({ length: MAX_RESOLUTION_WORKSPACES }, () => ({
    data: [{ user_id: MEMBER, org_id: ORG, project_id: null, workspace_id: null, role: "member" }],
    error: null,
  }));
  const batch = await listProductionResolutionTargets(
    client([{ data: rows, error: null }, ...actorResponses], []),
    "2026-08-18",
  );
  assert.equal(batch.targets.length, MAX_RESOLUTION_WORKSPACES);
  assert.equal(batch.truncated, true);
});

test("bounded mapper preserves result order and never exceeds concurrency", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 1 : 3));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(results, [0, 10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
  await assert.rejects(mapWithConcurrency([1], 0, async (value) => value), RangeError);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { readMetricHistory } from "./metric-history.ts";
import { readCurrentEdgeRows } from "./graph-query.ts";
import { importWorkspaceMetricCsv } from "../metrics/import.ts";

test("authenticated CSV import and history read exceed the API cap with exact inclusive windows", async (t) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !anon) { t.skip("Local Supabase credentials unavailable"); return; }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, key, options);
  const member = createClient(url, anon, options);
  const [org, project, scope, foreign] = Array.from({ length: 4 }, () => randomUUID());
  const email = `history-${randomUUID()}@example.test`;
  const password = `History-${randomUUID()}-A1!`;
  let actor: string | undefined;
  try {
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(user.error, null);
    actor = user.data.user!.id;
    assert.equal((await admin.from("orgs").insert({ org_id: org, name: "Bounded history test" })).error, null);
    assert.equal((await admin.from("projects").insert({ project_id: project, org_id: org, name: "Test" })).error, null);
    assert.equal((await admin.from("workspaces").insert([
      { workspace_id: scope, project_id: project, name: "Member" },
      { workspace_id: foreign, project_id: project, name: "Foreign" },
    ])).error, null);
    assert.equal((await admin.from("memberships").insert({ user_id: actor, org_id: org, workspace_id: scope, role: "member" })).error, null);
    assert.equal((await member.auth.signInWithPassword({ email, password })).error, null);
    const observations = Array.from({ length: 1501 }, (_, i) => ({
      date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), value: i + 0.25,
    }));
    const imported = await importWorkspaceMetricCsv(member, {
      scopeId: scope, name: "Long history", unit: "count", authoredBy: actor, observations,
    });
    assert.ok(imported.ok, imported.ok ? undefined : imported.error);
    if (!imported.ok) return;
    const metricId = imported.summary.metricId;
    assert.equal(imported.summary.insertedRows, 1501);
    const capped = await member.from("metric_observations").select("obs_date").eq("metric_id", metricId);
    assert.equal(capped.error, null);
    assert.equal(capped.data!.length, 1000, "positive control: API cap is active");
    const complete = await readMetricHistory(member, metricId);
    assert.equal(complete.rows.length, 1501);
    assert.equal(complete.rows.at(-1)!.obs_date, observations.at(-1)!.date);
    assert.equal(Number(complete.rows.at(-1)!.value), 1500.25);
    assert.equal(complete.completeness.complete, true);
    for (const [from, through] of [[499, 500], [500, 999], [1000, 1500]]) {
      const window = { from: observations[from].date, through: observations[through].date };
      const selected = await readMetricHistory(member, metricId, window);
      assert.deepEqual(selected.rows.map((row) => row.obs_date), observations.slice(from, through + 1).map((row) => row.date));
      assert.deepEqual(selected.completeness.window, window);
    }
    const foreignMetric = randomUUID();
    assert.equal((await admin.from("metrics").insert({ metric_id: foreignMetric, scope_id: foreign, name: "Hidden", source: "csv" })).error, null);
    assert.equal((await admin.from("metric_observations").insert({ metric_id: foreignMetric, obs_date: "2020-01-01", value: 99 })).error, null);
    assert.equal((await readMetricHistory(member, foreignMetric)).rows.length, 0);
    const targetNode = randomUUID();
    const actionIds = Array.from({ length: 1001 }, () => randomUUID());
    const nodeIds = actionIds.map(() => randomUUID());
    assert.equal((await member.from("nodes").insert({ node_id: targetNode, scope_id: scope, type: "METRIC", semantic_ref: metricId })).error, null);
    for (let i = 0; i < actionIds.length; i += 200) {
      assert.equal((await member.from("actions").insert(actionIds.slice(i, i + 200)
        .map((action_id) => ({ action_id, scope_id: scope, source: "manual" })))).error, null);
      assert.equal((await member.from("nodes").insert(actionIds.slice(i, i + 200)
        .map((semantic_ref, j) => ({ node_id: nodeIds[i + j], scope_id: scope, type: "ACTION", semantic_ref })))).error, null);
      assert.equal((await member.from("causal_edges").insert(nodeIds.slice(i, i + 200)
        .map((source_node_id) => ({ scope_id: scope, source_node_id, target_node_id: targetNode,
          direction: "POSITIVE", belief_score: 0.3, authoritative_method: "MANUAL" })))).error, null);
    }
    const plainGraph = await member.from("current_edge_readouts").select("edge_id").eq("scope_id", scope);
    assert.equal(plainGraph.error, null);
    assert.equal(plainGraph.data!.length, 1000);
    const graph = await readCurrentEdgeRows(member, scope);
    assert.equal(graph.rows.length, 1001);
    assert.equal(graph.completeness.complete, true);
    assert.ok(graph.rows.every((row) => row.provenance === "manual" && row.lift === null && row.belief_score === null));
    const manualEdge = graph.rows[0].edge_id;
    assert.equal((await member.from("causal_edges").update({ belief_score: 0.31 }).eq("edge_id", manualEdge)).error?.code, "23514");
    assert.equal((await member.from("causal_edges").update({ authoritative_method: "ITS" }).eq("edge_id", manualEdge)).error?.code, "42501");
    assert.equal((await readCurrentEdgeRows(member, foreign)).rows.length, 0);
    await assert.rejects(readMetricHistory(member, metricId, { from: "2026-02-30" }), /Invalid history/);
    await assert.rejects(readMetricHistory(member, metricId, { from: "2026-02-02", through: "2026-02-01" }), /Invalid history/);
  } finally {
    assert.equal((await admin.from("orgs").delete().eq("org_id", org)).error, null);
    if (actor) assert.equal((await admin.auth.admin.deleteUser(actor)).error, null);
  }
});

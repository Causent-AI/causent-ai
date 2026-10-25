import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Optional isolated PostgreSQL runtime. Never reads hosted credentials.
// CAUSENT_TEST_PGLITE=file:///.../@electric-sql/pglite/dist/index.js node --test lib/projects/setup.integration.test.ts
const moduleUrl = process.env.CAUSENT_TEST_PGLITE;
test("Day 0 project creation, retries, milestones and tenant permissions", { skip: !moduleUrl }, async () => {
  const { PGlite } = await import(moduleUrl!);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
    for (const file of ["20260703223627_v1_schema.sql", "20260703223628_v1_rls.sql"]) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    await db.exec(`grant usage on schema public to authenticated, anon;
      grant select, insert, update on all tables in schema public to authenticated;
      alter table public.workspaces add column archived_at timestamptz;`);
    // Use the current archive-aware scope helper, not just the initial schema.
    const tenancy = await readFile(new URL("../../supabase/migrations/20260907053500_t05_t10_measurement_and_tenancy.sql", import.meta.url), "utf8");
    await db.exec(tenancy.slice(tenancy.indexOf("create or replace function public.has_scope_access"), tenancy.indexOf("create table private.customer_provisioning_requests")));
    await db.exec(await readFile(new URL("../../supabase/migrations/20261025050042_day_zero_projects.sql", import.meta.url), "utf8"));
    const owner = "10000000-0000-4000-8000-000000000001", foreign = "10000000-0000-4000-8000-000000000002", viewer = "10000000-0000-4000-8000-000000000003", member = "10000000-0000-4000-8000-000000000004";
    const org = "20000000-0000-4000-8000-000000000001", otherOrg = "20000000-0000-4000-8000-000000000002", workspace = "30000000-0000-4000-8000-000000000001";
    await db.exec(`insert into auth.users values('${owner}'),('${foreign}'),('${viewer}'),('${member}');
      insert into public.orgs(org_id,name) values('${org}','A'),('${otherOrg}','B');
      insert into public.memberships(user_id,org_id,role) values('${owner}','${org}','owner'),('${foreign}','${otherOrg}','owner'),('${viewer}','${org}','viewer'),('${member}','${org}','member');`);
    const asUser = async (user: string) => { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`); };
    const create = (metrics: string[], milestones: string[]) => db.query("select public.create_day_zero_project_v1($1,'Website','Launch a website',$2,$3,$4) id", [org, metrics, milestones, workspace]);
    await asUser(owner);
    assert.equal((await create([], ["Launch", "Analytics installed"])).rows[0].id, workspace);
    await create([], ["Launch", "Analytics installed"]);
    assert.equal((await db.query("select count(*)::int n from public.project_plans")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from public.metrics")).rows[0].n, 0);
    assert.equal((await db.query("select cardinality(planned_metrics) n from public.project_plans")).rows[0].n, 0);
    await assert.rejects(create(["Changed request"], []));
    await assert.rejects(db.query("select public.create_day_zero_project_v1($1,'Bad','', '{}','{}',gen_random_uuid())", [org]));
    await asUser(member);
    await db.exec("update public.project_milestones set completed=true where title='Launch'; update public.project_plans set planned_metrics=array['Conversion rate'];");
    assert.equal((await db.query("select completed from public.project_milestones where title='Launch'")).rows[0].completed, true);
    await assert.rejects(db.exec("update public.project_milestones set scope_id=gen_random_uuid()"));
    await assert.rejects(create([], []));
    await asUser(viewer);
    assert.equal((await db.query("update public.project_milestones set completed=false returning milestone_id")).rows.length, 0);
    assert.equal((await db.query("select count(*)::int n from public.project_milestones")).rows[0].n, 2);
    await asUser(foreign);
    assert.equal((await db.query("select count(*)::int n from public.project_plans")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from public.project_milestones")).rows[0].n, 0);
    await assert.rejects(create([], []));
    assert.equal((await db.query("update public.project_milestones set completed=false returning milestone_id")).rows.length, 0);
    assert.equal((await db.query("update public.project_plans set planned_metrics='{}' returning scope_id")).rows.length, 0);
    await assert.rejects(db.exec("delete from public.project_milestones"));
    await assert.rejects(db.query("insert into public.project_milestones(scope_id,title) values($1,'Foreign')", [workspace]));
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.query("select * from public.project_plans"));
    await assert.rejects(create([], []));
    await db.exec(`reset role; update public.workspaces set archived_at=now() where workspace_id='${workspace}';`);
    await asUser(member);
    assert.equal((await db.query("update public.project_milestones set completed=false returning milestone_id")).rows.length, 0);
  } finally { await db.close(); }
});

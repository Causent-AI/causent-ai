-- Project setup exists before a report or observed metric. Completion milestones
-- are deliberately separate from causal/performance observations.
create table public.project_plans (
  scope_id uuid primary key references public.workspaces(workspace_id) on delete cascade,
  goal text not null check (length(trim(goal)) between 1 and 4000),
  planned_metrics text[] not null default '{}' check (cardinality(planned_metrics) <= 30),
  created_at timestamptz not null default now()
);
create table public.project_milestones (
  milestone_id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.project_plans(scope_id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index project_milestones_scope_idx on public.project_milestones(scope_id, created_at, milestone_id);
alter table public.project_plans enable row level security;
alter table public.project_milestones enable row level security;
revoke all on public.project_plans, public.project_milestones from anon, authenticated;
grant select, insert on public.project_plans to authenticated;
grant update(planned_metrics) on public.project_plans to authenticated;
grant select, insert on public.project_milestones to authenticated;
grant update(completed) on public.project_milestones to authenticated;
grant all on public.project_plans, public.project_milestones to service_role;
create policy project_plans_read on public.project_plans for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
create policy project_plans_create on public.project_plans for insert to authenticated
  with check (public.has_scope_access(scope_id, 'admin'));
create policy project_plans_measurement on public.project_plans for update to authenticated
  using (public.has_scope_access(scope_id, 'member'))
  with check (public.has_scope_access(scope_id, 'member'));
create policy project_milestones_read on public.project_milestones for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
create policy project_milestones_create on public.project_milestones for insert to authenticated
  with check (public.has_scope_access(scope_id, 'member'));
create policy project_milestones_complete on public.project_milestones for update to authenticated
  using (public.has_scope_access(scope_id, 'member'))
  with check (public.has_scope_access(scope_id, 'member'));

-- Invoker retains existing project/workspace insert RLS. All writes are atomic.
create function public.create_day_zero_project_v1(p_org_id uuid, p_title text, p_goal text,
  p_metrics text[], p_milestones text[], p_workspace_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_project uuid := gen_random_uuid();
begin
  if auth.uid() is null or not exists (
    select 1 from public.memberships m where m.user_id = auth.uid()
      and m.org_id = p_org_id and m.project_id is null and m.workspace_id is null
      and m.role in ('owner','admin')
  ) then
    raise exception using errcode = '42501', message = 'Organization admin access is required';
  end if;
  if p_title is null or length(trim(p_title)) not between 1 and 120
    or p_goal is null or length(trim(p_goal)) not between 1 and 4000
    or p_workspace_id is null or p_metrics is null or p_milestones is null
    or cardinality(p_metrics) > 30 or cardinality(p_milestones) > 30
    or exists(select 1 from unnest(p_metrics || p_milestones) v where v is null or length(trim(v)) not between 1 and 300)
  then raise exception using errcode = '22023', message = 'Invalid project setup'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  -- A client-generated workspace ID makes a retry safe without duplicate projects.
  if exists(select 1 from public.project_plans where scope_id = p_workspace_id) then
    if not exists(select 1 from public.workspaces w join public.projects p using(project_id)
      where w.workspace_id=p_workspace_id and p.org_id=p_org_id and p.name=trim(p_title)) or not exists(select 1 from public.project_plans
        where scope_id=p_workspace_id and goal=trim(p_goal) and planned_metrics=p_metrics) then
      raise exception using errcode='22023', message='Project request does not match';
    end if;
    return p_workspace_id;
  end if;
  insert into public.projects(project_id, org_id, name) values(new_project, p_org_id, trim(p_title));
  insert into public.workspaces(workspace_id, project_id, name) values(p_workspace_id, new_project, trim(p_title));
  insert into public.project_plans(scope_id, goal, planned_metrics) values(p_workspace_id, trim(p_goal), p_metrics);
  insert into public.project_milestones(scope_id, title) select p_workspace_id, trim(v) from unnest(p_milestones) v;
  return p_workspace_id;
end;
$$;
revoke all on function public.create_day_zero_project_v1(uuid,text,text,text[],text[],uuid) from public, anon;
grant execute on function public.create_day_zero_project_v1(uuid,text,text,text[],text[],uuid) to authenticated;

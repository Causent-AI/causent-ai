-- Dedicated, mutually isolated database identities for the three stateful
-- Python workers. The source contract is deliberately passwordless NOLOGIN;
-- release operations enable LOGIN and attach generated credentials outside
-- migration history after these bounded privileges land.
--
-- PostgreSQL 17 membership options let recompute and resolve SET ROLE to the
-- existing authenticated RLS identity without inheriting it. No worker is a
-- service_role member, so a leaked worker credential cannot assume or inherit
-- that application's broad Data API privileges.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'causent_drift_worker'
  ) then
    create role causent_drift_worker
      noinherit bypassrls nosuperuser nocreatedb nocreaterole
      noreplication nologin;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'causent_recompute_worker'
  ) then
    create role causent_recompute_worker
      noinherit bypassrls nosuperuser nocreatedb nocreaterole
      noreplication nologin;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'causent_resolve_worker'
  ) then
    create role causent_resolve_worker
      noinherit nobypassrls nosuperuser nocreatedb nocreaterole
      noreplication nologin;
  end if;
end;
$$;

-- A migration runner with CREATEROLE can disable login credentials, but
-- PostgreSQL intentionally rejects ALTER ROLE statements that even mention
-- superuser-class attributes unless the caller is itself a superuser. Create
-- those attributes once above, clear any rehearsal password here, and fail
-- closed below if an operator pre-created an incompatible role.
alter role causent_drift_worker nologin password null;
alter role causent_recompute_worker nologin password null;
alter role causent_resolve_worker nologin password null;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'causent_drift_worker'
      and (
        rolinherit or not rolbypassrls or rolsuper or rolcreatedb
        or rolcreaterole or rolreplication or rolcanlogin
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'CAUSENT_DRIFT_WORKER_ROLE_MISMATCH';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'causent_recompute_worker'
      and (
        rolinherit or not rolbypassrls or rolsuper or rolcreatedb
        or rolcreaterole or rolreplication or rolcanlogin
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'CAUSENT_RECOMPUTE_WORKER_ROLE_MISMATCH';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'causent_resolve_worker'
      and (
        rolinherit or rolbypassrls or rolsuper or rolcreatedb
        or rolcreaterole or rolreplication or rolcanlogin
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'CAUSENT_RESOLVE_WORKER_ROLE_MISMATCH';
  end if;
end;
$$;

-- Drift never assumes an application identity. Recompute switches only after
-- resolving a job's stored actor, while resolve starts every sweep under the
-- explicitly supplied authenticated actor. Remove every rehearsal membership
-- first so the grants below are the exact relationship graph.
do $$
declare
  v_membership record;
begin
  for v_membership in
    select parent.rolname as parent_role, member.rolname as member_role
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as parent on parent.oid = membership.roleid
    join pg_catalog.pg_roles as member on member.oid = membership.member
    where member.rolname in (
      'causent_drift_worker',
      'causent_recompute_worker',
      'causent_resolve_worker'
    )
  loop
    execute pg_catalog.format(
      'revoke %I from %I',
      v_membership.parent_role,
      v_membership.member_role
    );
  end loop;
end;
$$;

grant authenticated to causent_recompute_worker
  with admin false, inherit false, set true;
grant authenticated to causent_resolve_worker
  with admin false, inherit false, set true;

-- Clear direct rehearsal grants before applying each worker's complete table
-- contract. The roles are NOINHERIT, and the only remaining memberships are
-- SET-only, so these become their effective direct application privileges.
revoke all privileges on schema public, private from
  causent_drift_worker,
  causent_recompute_worker,
  causent_resolve_worker;
revoke all privileges on all tables in schema public, private from
  causent_drift_worker,
  causent_recompute_worker,
  causent_resolve_worker;
revoke all privileges on all sequences in schema public, private from
  causent_drift_worker,
  causent_recompute_worker,
  causent_resolve_worker;

-- Drift claims only its queue, reads the detector inputs, and replaces only the
-- current derived projection. It cannot mutate predictions, reports, actions,
-- evidence, or any other canonical/audit row.
grant usage on schema public, private to causent_drift_worker;
grant select, update on table private.drift_refresh_jobs
  to causent_drift_worker;
grant select on table
  public.predictions,
  public.decisions,
  public.metrics,
  public.metric_observations,
  public.levers,
  public.actions,
  public.workspaces,
  public.decision_report_series,
  public.decision_reports,
  public.decision_report_activations,
  public.decision_report_package_interventions,
  public.current_prediction_drift
to causent_drift_worker;
grant insert, delete on table public.current_prediction_drift
  to causent_drift_worker;

-- Recompute claims only its queue and locks the current immutable report target
-- before switching to the job's stored authenticated actor. All graph reads and
-- writes occur after that role switch under the existing workspace RLS policy.
grant usage on schema public, private to causent_recompute_worker;
grant select, update on table private.causal_recompute_jobs
  to causent_recompute_worker;
grant select on table
  public.decision_reports,
  public.decision_report_series,
  public.workspaces,
  public.decision_report_activations,
  public.decision_report_package_interventions,
  public.projects,
  public.memberships
to causent_recompute_worker;

-- SELECT ... FOR UPDATE requires UPDATE on at least one column of every locked
-- relation. Grant only immutable primary keys, not table-level UPDATE. Their
-- restrictive references prevent a meaningful key mutation; the worker uses
-- these privileges solely to hold the activation/pointer rows stable.
grant update (report_id)
  on table public.decision_reports to causent_recompute_worker;
grant update (series_id)
  on table public.decision_report_series to causent_recompute_worker;
grant update (workspace_id)
  on table public.workspaces to causent_recompute_worker;
grant update (activation_id)
  on table public.decision_report_activations to causent_recompute_worker;

-- Resolve has no direct application-table or private-schema grant. Its only
-- capability is the SET-only authenticated membership above, so the existing
-- RLS policies govern the complete resolution sweep.

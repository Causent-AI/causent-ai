-- Hosted Supabase grants EXECUTE on new public functions to anon by default.
-- That is acceptable for explicitly public SECURITY INVOKER RPCs, but never
-- for SECURITY DEFINER functions: those run with their owner's privileges.
-- Remove the default for future postgres-owned functions and close the
-- historical functions that predate the repository's explicit anon revokes.

-- PostgreSQL's built-in default grants function EXECUTE to PUBLIC globally.
-- A schema-local revoke cannot override that global default, so revoke at the
-- owner level first. Keep the schema-local revoke as defense in depth against
-- hosted defaults that explicitly name anon.
alter default privileges for role postgres
  revoke execute on functions from public, anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon',
      v_function
    );
  end loop;
end;
$$;

-- Prove the owner-level default is effective. This probe is created only
-- inside the migration transaction and is dropped before PostgREST reloads.
create function public.causent_acl_default_probe_v1()
returns integer
language sql
security definer
set search_path = ''
as $$
  select 1
$$;

do $$
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.causent_acl_default_probe_v1()',
    'EXECUTE'
  ) then
    raise exception 'ANON_DEFAULT_FUNCTION_EXECUTE_REMAINS'
      using errcode = '42501';
  end if;
end;
$$;

drop function public.causent_acl_default_probe_v1();

-- RLS policies call these self-gating helpers as authenticated users. Keep
-- only the roles that legitimately need to execute them.
grant execute on function public.has_scope_grant(uuid, uuid, uuid, text)
  to authenticated, service_role;
grant execute on function public.has_scope_access(uuid, text)
  to authenticated, service_role;
grant execute on function public.has_org_access(uuid, text)
  to authenticated, service_role;
grant execute on function public.has_project_access(uuid, text)
  to authenticated, service_role;
grant execute on function public.metric_scope(uuid)
  to authenticated, service_role;
grant execute on function public.decision_scope(uuid)
  to authenticated, service_role;
grant execute on function public.prediction_scope(uuid)
  to authenticated, service_role;
grant execute on function public.action_scope(uuid)
  to authenticated, service_role;

-- The role comparator is SECURITY INVOKER, but it is used by the privileged
-- RLS helpers. Fix its search path and remove the unnecessary anonymous RPC.
alter function public.role_rank(text) set search_path = '';
revoke execute on function public.role_rank(text) from public, anon;
grant execute on function public.role_rank(text)
  to authenticated, service_role;

-- GoTrue owns the signup path. The trigger does not need to be callable as a
-- public RPC by application roles.
revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Fail closed if a current privileged function was missed or a prior explicit
-- anon grant survived the cleanup.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'ANON_SECURITY_DEFINER_EXECUTE_REMAINS'
      using errcode = '42501';
  end if;
end;
$$;

notify pgrst, 'reload schema';

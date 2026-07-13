-- ============================================================================
-- FUNNEL EVENTS  (onboarding + resolution instrumentation — C2/#15, C5/#18)
-- ============================================================================
-- The smallest honest events seam: one append-only row per funnel touch, so we
-- can compute the #15 DoD metrics (time-to-first-type, Step-4 commit rate,
-- step drop-off) and the #18 resolution-return rate WITHOUT a third-party
-- analytics dependency. The row's created_at is the SERVER clock (never
-- hand-picked); the client only supplies ms_since_start (a client-measured
-- interaction latency, e.g. landing -> first keystroke) and the funnel step.
--
-- One event = one funnel touch. session_key ties a single funnel run's events
-- together (a client-generated opaque key) so drop-off and commit rate can be
-- computed per-run without a user id (local demo has none).
--
-- RLS mirrors the domain-table pattern (member writes, viewer reads; no delete
-- policy — service_role bypasses). Explicit grants: CI applies no implicit
-- defaults (see 20260709000000_grant_base_privileges.sql).

create table public.funnel_events (
  event_id        uuid primary key default gen_random_uuid(),
  scope_id        uuid not null references public.workspaces(workspace_id) on delete cascade,
  -- The authenticated actor (populates return-rate cohorts); NULL in local demo.
  user_id         uuid references auth.users(id) on delete set null,
  -- Opaque per-funnel-run key generated client-side; ties a run's events.
  session_key     text not null,
  event_type      text not null check (event_type in (
    'LANDED',          -- funnel mounted (denominator for commit rate + drop-off)
    'STEP_VIEW',       -- a step became visible (drop-off curve; `step` set)
    'FIRST_TYPE',      -- first keystroke in the paste box (`ms_since_start` set)
    'STRUCTURED',      -- paste structured into a decision card
    'COMMITTED',       -- prediction committed (Step-4 numerator)
    'SHIP_STATE',      -- ship-state screen reached (Step 7, #18)
    'SCORECARD_VIEW'   -- a resolved scorecard was viewed (return-rate, #18)
  )),
  -- Funnel step for the drop-off curve: paste | card | commit | done.
  step            text,
  -- Client-measured elapsed ms since the funnel LANDED (time-to-first-type etc.).
  ms_since_start  integer,
  meta            jsonb,
  created_at      timestamptz not null default now()
);

create index funnel_events_scope_created_idx on public.funnel_events(scope_id, created_at);
create index funnel_events_session_idx on public.funnel_events(session_key);

alter table public.funnel_events enable row level security;

create policy funnel_events_select on public.funnel_events for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
create policy funnel_events_insert on public.funnel_events for insert to authenticated
  with check (public.has_scope_access(scope_id, 'member'));
-- No update/delete policy: events are append-only (service_role bypasses).

-- Table-level grants (explicit — no implicit defaults under CI).
grant select, insert on public.funnel_events to authenticated, service_role;

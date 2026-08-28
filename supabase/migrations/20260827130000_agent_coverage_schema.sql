-- Agent coverage: the two tables the new scope model needs, and nothing else.
--
-- WHAT THIS IS FOR
--
-- An ACSL agent's coverage is frozen at the moment somebody last assigned them.
-- `resolveAssignedOrgIds` grants a state only when the agent has zero named
-- partners, and the admin UI materialises every partner of a chosen state into
-- the named list, which guarantees the list is never empty and so permanently
-- disables the state rule. Partners created afterwards never reach the agent,
-- and because create-sale gates on the same list, they cannot be sold for
-- either. One manager is currently blind to 33 partners holding 1,788 stoves.
--
-- The model this enables: a state grants every partner in it, including ones
-- created later; specific partners may be excluded from that; or an agent is
-- scoped to an explicit named list, which is today's behaviour.
--
-- WHY THIS MIGRATION CHANGES NOTHING
--
-- Two empty tables and one read-only view. No existing table is altered, no
-- existing row is touched, and no code reads any of this yet. The backfill,
-- the resolver and the UI are separate changes, in that order, so this can
-- land on a live system with no observable effect and be reverted by dropping
-- three objects.
--
-- `mode` is deliberately NULLABLE with no default. NULL means "resolve the way
-- the current code does", which makes the new resolver a behavioural no-op for
-- any row that has not been backfilled, including rows written by older code
-- during a deploy. The default is safety, not a guess.

-- ---------------------------------------------------------------------------
-- 1. Which rule applies to an agent
-- ---------------------------------------------------------------------------

create table if not exists public."acsl_agent_scope" (
  "agent_id"   uuid not null,
  "mode"       text,
  "updated_by" uuid,
  "updated_at" timestamp with time zone default now() not null
);

alter table public."acsl_agent_scope"
  add constraint "acsl_agent_scope_pkey" primary key ("agent_id");

alter table public."acsl_agent_scope"
  add constraint "acsl_agent_scope_agent_id_fkey"
  foreign key ("agent_id") references public."profiles"("id") on delete cascade;

alter table public."acsl_agent_scope"
  add constraint "acsl_agent_scope_updated_by_fkey"
  foreign key ("updated_by") references public."profiles"("id");

-- Only the two real modes, or NULL for "behave as the old code did".
alter table public."acsl_agent_scope"
  add constraint "acsl_agent_scope_mode_check"
  check ("mode" is null or "mode" in ('state_coverage', 'explicit_partners'));

comment on table public."acsl_agent_scope" is
  'How an ACSL agent''s partner coverage is decided. state_coverage: every partner in their assigned states, minus exclusions, including partners created later. explicit_partners: only the partners named in acsl_agent_organizations. NULL: resolve the legacy way, which is explicit when any named partner exists and state coverage otherwise.';

comment on column public."acsl_agent_scope"."mode" is
  'NULL is not "unset by mistake". It means resolve exactly as the pre-existing code did, so an un-backfilled row behaves identically under old and new resolvers.';

-- ---------------------------------------------------------------------------
-- 2. Partners carved out of a state the agent otherwise covers
-- ---------------------------------------------------------------------------
--
-- A separate table rather than a flag on acsl_agent_organizations, because
-- public.super_admin_agent_organizations is a view over that table and is read
-- by code this change does not touch. A row meaning "exclude" sitting in a
-- table whose readers all mean "grant" is a silent privilege escalation. A new
-- table cannot be misread: code that does not know about it over-reports
-- coverage, which is visible, rather than under-restricting it, which is not.

create table if not exists public."acsl_agent_organization_exclusions" (
  "id"              uuid default gen_random_uuid() not null,
  "agent_id"        uuid not null,
  "organization_id" uuid not null,
  "excluded_by"     uuid,
  "excluded_at"     timestamp with time zone default now() not null
);

alter table public."acsl_agent_organization_exclusions"
  add constraint "acsl_agent_org_exclusions_pkey" primary key ("id");

alter table public."acsl_agent_organization_exclusions"
  add constraint "acsl_agent_org_exclusions_unique" unique ("agent_id", "organization_id");

alter table public."acsl_agent_organization_exclusions"
  add constraint "acsl_agent_org_exclusions_agent_id_fkey"
  foreign key ("agent_id") references public."profiles"("id") on delete cascade;

alter table public."acsl_agent_organization_exclusions"
  add constraint "acsl_agent_org_exclusions_org_id_fkey"
  foreign key ("organization_id") references public."organizations"("id") on delete cascade;

alter table public."acsl_agent_organization_exclusions"
  add constraint "acsl_agent_org_exclusions_excluded_by_fkey"
  foreign key ("excluded_by") references public."profiles"("id");

create index if not exists "idx_aaoe_agent_id"
  on public."acsl_agent_organization_exclusions" using btree ("agent_id");
create index if not exists "idx_aaoe_org_id"
  on public."acsl_agent_organization_exclusions" using btree ("organization_id");

comment on table public."acsl_agent_organization_exclusions" is
  'Partners an agent does NOT cover despite holding their state. Read only when acsl_agent_scope.mode is state_coverage; inert otherwise, which is what lets an agent be switched between modes and back without losing either set.';

-- ---------------------------------------------------------------------------
-- 3. Row level security, mirroring the tables these sit beside
-- ---------------------------------------------------------------------------

alter table public."acsl_agent_scope" enable row level security;
alter table public."acsl_agent_organization_exclusions" enable row level security;

create policy "agent_read_own" on public."acsl_agent_scope"
  as permissive for select to "authenticated"
  using ((agent_id = auth.uid()));

create policy "super_admin_full_access" on public."acsl_agent_scope"
  as permissive for all to "authenticated"
  using ((exists ( select 1
     from profiles
    where ((profiles.id = auth.uid()) and (profiles.role = 'super_admin'::text)))));

create policy "agent_read_own" on public."acsl_agent_organization_exclusions"
  as permissive for select to "authenticated"
  using ((agent_id = auth.uid()));

create policy "super_admin_full_access" on public."acsl_agent_organization_exclusions"
  as permissive for all to "authenticated"
  using ((exists ( select 1
     from profiles
    where ((profiles.id = auth.uid()) and (profiles.role = 'super_admin'::text)))));

-- Deliberately narrower than the neighbouring tables, which carry
-- insert/update/delete/truncate for anon and authenticated. That is wider than
-- anything needs; RLS is what actually holds the line there. New tables start
-- correct rather than inheriting an old habit. Writes go through the
-- service-role edge functions.
grant select on public."acsl_agent_scope" to "anon", "authenticated";
grant all on public."acsl_agent_scope" to "service_role";
grant select on public."acsl_agent_organization_exclusions" to "anon", "authenticated";
grant all on public."acsl_agent_organization_exclusions" to "service_role";

-- ---------------------------------------------------------------------------
-- 4. State names: diagnose now, change nothing
-- ---------------------------------------------------------------------------
--
-- Coverage by state matches organizations.state against acsl_agent_states.state
-- by exact string equality. Both are free text with no shared vocabulary and no
-- foreign key, while public.nigeria_states already holds the canonical 37.
--
-- Today that is untidy. Once a state grants coverage it becomes load-bearing: a
-- name that does not match is a silent under-grant, and a typo on a newly
-- created partner would be an over-grant. One partner already sits in 'Abuja',
-- which is not among the 37, so it is unreachable by state coverage right now.
--
-- This view only reports. Deciding what 'Abuja' should be is somebody's call
-- about a real partner's real coverage, not a migration's.

create or replace view public."acsl_state_name_health"
with (security_invoker = true) as
  select 'organizations'::text as source,
         o.state               as state_value,
         count(*)              as rows_affected,
         (ns_exact.name is not null)  as matches_canonical_exactly,
         (ns_loose.name is not null)  as matches_ignoring_case
    from public.organizations o
    left join public.nigeria_states ns_exact on ns_exact.name = o.state
    left join public.nigeria_states ns_loose on lower(btrim(ns_loose.name)) = lower(btrim(o.state))
   group by o.state, ns_exact.name, ns_loose.name
  union all
  select 'acsl_agent_states',
         s.state,
         count(*),
         (ns_exact.name is not null),
         (ns_loose.name is not null)
    from public.acsl_agent_states s
    left join public.nigeria_states ns_exact on ns_exact.name = s.state
    left join public.nigeria_states ns_loose on lower(btrim(ns_loose.name)) = lower(btrim(s.state))
   group by s.state, ns_exact.name, ns_loose.name;

comment on view public."acsl_state_name_health" is
  'Every distinct state string in use, and whether it matches nigeria_states exactly, only ignoring case, or not at all. Read-only. A row with matches_canonical_exactly = false is a partner or an assignment that state-based coverage cannot connect.';

grant select on public."acsl_state_name_health" to "authenticated", "service_role";

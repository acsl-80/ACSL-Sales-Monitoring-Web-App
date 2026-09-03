-- ===========================================================================
-- The partner list is grouped, sorted and paged in SQL.
--
-- Slice 6b of the 2026-09-02 review (finding F4). get-organizations-grouped
-- fetched every organisation, asked for an exact count and discarded it, then
-- grouped, sorted and paged the rows in TypeScript. An unranged select stops
-- at 1,000 rows (max_rows in supabase/config.toml), so past a thousand
-- organisations the list and its count would go quietly short. Production
-- holds 445 today in 433 groups; this is the door closed before it matters.
--
-- GROUPING IS BY EXACT partner_name after case and whitespace are normalised,
-- and by nothing else. This rule is carried over from the function, where it
-- was earned: an older version merged any two names sharing half their words
-- and picked a label by heuristic, which silently folded "Swali Global Multi
-- Concept (Amina Sales Model)" into "Swali Global Multi Concept" and dropped
-- the Amina variant, and all its stoves, from every screen that read the list.
-- A parenthetical suffix, a payment-model tag or a spelling difference IS a
-- different partner record with its own stock. If genuine duplicates appear,
-- the fix is a data cleanup in organizations, not fuzzy grouping here.
--
-- SHAPE. The same rows the function has always returned: base_name, the
-- branches with id, branch (Main Branch when blank), state, full_name and
-- partner_type, the organization_ids, and branch_count; plus total_count, the
-- number of groups, which is what the pagination has always reported.
--
-- ACCESS. Service role only; the function keeps its super-admin gate.
-- ===========================================================================

create or replace function public.organizations_grouped(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 30
)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with base as (
  select o.id, o.partner_name, o.branch, o.state, o.partner_type,
         lower(btrim(coalesce(o.partner_name, ''))) as key
    from public.organizations o
   where p_search is null or btrim(p_search) = ''
      or o.partner_name ilike '%' || p_search || '%'
),
groups as (
  select key,
         min(partner_name) as base_name,
         jsonb_agg(jsonb_build_object(
             'id', id,
             'branch', coalesce(nullif(branch, ''), 'Main Branch'),
             'state', state,
             'full_name', partner_name,
             'partner_type', partner_type)
           order by coalesce(nullif(branch, ''), 'Main Branch'), id) as branches,
         jsonb_agg(id order by coalesce(nullif(branch, ''), 'Main Branch'), id) as organization_ids,
         count(*)::integer as branch_count
    from base
   group by key
),
paged as (
  select *
    from groups
   order by lower(base_name), base_name
  offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 30), 1)
   limit greatest(coalesce(p_page_size, 30), 1)
)
select jsonb_build_object(
  'data', coalesce((select jsonb_agg(jsonb_build_object(
                              'base_name', base_name,
                              'branches', branches,
                              'organization_ids', organization_ids,
                              'branch_count', branch_count)
                            order by lower(base_name), base_name)
                      from paged), '[]'::jsonb),
  'total_count', (select count(*) from groups)
);
$$;

comment on function public.organizations_grouped(text, integer, integer) is
  'Organisations grouped by exact partner_name (case and whitespace normalised), sorted and paged, with the number of groups. Slice 6b of the 2026-09-02 review.';

revoke all on function public.organizations_grouped(text, integer, integer) from public, anon, authenticated;
grant execute on function public.organizations_grouped(text, integer, integer) to service_role;

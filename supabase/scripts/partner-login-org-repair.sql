-- Partner logins with no partner: put back the ones whose partner is on record.
--
-- User Management sent a partner only for agent roles, so a login created as a
-- Partner, or moved into the Partner group, was saved with no organisation.
-- create-sale refuses a caller with no organisation. Fixed in the app and in
-- manage-users by fix/partner-login-carries-org; this repairs what came before.
--
-- Which logins: role partner, no organisation, and a credentials row (written
-- by manage-users when the login was made) naming exactly one partner that
-- still exists. A login with no such evidence is left alone: which partner it
-- belongs to, or whether it should exist, is the operator's call.
--
-- Production on 2026-10-16: 2 Partner logins with no organisation, neither has
-- made a sale. 1 has the evidence (made as a Partner Agent, later moved into the
-- Partner group); 1 has none.
--
-- WHEN: any time. User Manager does not list Partner rows, so nothing on that
-- page can clear this again, and after the fix manage-users refuses it anyway.
--
-- HOW:
--   1. Dry run (expect repairable = 1, left_alone = 1 on 2026-10-16):
--        select count(*) filter (where n_orgs = 1) as repairable,
--               count(*) filter (where n_orgs <> 1) as left_alone
--          from (select p.id,
--                       (select count(distinct c.organization_id)
--                          from public.credentials c
--                          join public.organizations o on o.id = c.organization_id
--                         where c.user_id = p.id) as n_orgs
--                  from public.profiles p
--                 where p.role = 'partner' and p.organization_id is null) x;
--   2. Run the statement below. It is one statement, so it lands whole or not
--      at all. Its result should read profiles_fixed and logins_fixed equal to
--      the dry run's repairable. Run it again and both read 0.
--
-- PROOF (expect the dry run's left_alone, 1 on 2026-10-16):
--   select count(*) from public.profiles where role = 'partner' and organization_id is null;
-- And no Partner whose app_metadata disagrees with the profile (expect 0):
--   select count(*) from public.profiles p join auth.users u on u.id = p.id
--    where p.role = 'partner' and p.organization_id is not null
--      and u.raw_app_meta_data ? 'organization_id'
--      and u.raw_app_meta_data->>'organization_id' <> p.organization_id::text;
--
-- UNDO: the result lists the ids it changed. For each:
--   update public.profiles set organization_id = null where id = '<id>';
--   update auth.users set raw_app_meta_data = raw_app_meta_data - 'organization_id' where id = '<id>';
--
-- The role is left alone. A login moved into the Partner group before 27 Sep
-- may still say partner_agent in app_metadata, from before edits kept the two
-- in step; that is a separate decision.

with target as (
  select p.id, min(c.organization_id::text)::uuid as organization_id
    from public.profiles p
    join public.credentials c on c.user_id = p.id
    join public.organizations o on o.id = c.organization_id
   where p.role = 'partner'
     and p.organization_id is null
   group by p.id
  having count(distinct c.organization_id) = 1
),
p as (
  update public.profiles pr
     set organization_id = t.organization_id
    from target t
   where pr.id = t.id
     and pr.organization_id is null
  returning pr.id, pr.organization_id
),
u as (
  update auth.users au
     set raw_app_meta_data = coalesce(au.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('organization_id', p.organization_id)
    from p
   where au.id = p.id
  returning au.id
)
select (select count(*) from p) as profiles_fixed,
       (select count(*) from u) as logins_fixed,
       (select array_agg(id) from p) as ids_changed;

-- Partner logins with no partner: put the one we can prove back on its partner.
--
-- User Management sent a partner only for agent roles, so a login created as a
-- Partner, or moved into the Partner group, was saved with no organisation.
-- create-sale refuses a caller with no organisation. Fixed in the app and in
-- manage-users by fix/partner-login-carries-org; this repairs what came before.
--
-- Production on 2026-10-16: 477 Partner logins, 2 with no organisation, no sales
-- made by either.
--
--   a42022a2-782c-4dc9-8fdc-d0ae62308cd9  created 2026-09-17 as a Partner Agent
--     for Inclusive Engagement Network for development (IEND), Kaduna, per its
--     credentials row; later moved to the Partner group, which cleared it.
--     Repaired here.
--   470f3109-4922-4b9d-8e03-a1b8155f548d  created 2026-04-28, never signed in,
--     no credentials row, no partner matches its email or name. Not touched:
--     which partner it belongs to, or whether it should exist, is the
--     operator's call.
--
-- WHEN: any time. User Manager does not list Partner rows, so nothing on that
-- page can clear this again, and after the fix manage-users refuses it anyway.
--
-- HOW: run this whole file in the SQL editor. It is one statement, so it lands
-- whole or not at all. Its result row should read profiles_fixed = 1 and
-- logins_fixed = 1. Run it again and both read 0.
--
-- PROOF (expect one row: partner, the IEND id twice):
--   select p.role, p.organization_id, u.raw_app_meta_data->>'organization_id' as meta_org
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.id = 'a42022a2-782c-4dc9-8fdc-d0ae62308cd9';
-- And the count left (expect 1, the April login):
--   select count(*) from public.profiles where role = 'partner' and organization_id is null;
--
-- UNDO:
--   update public.profiles set organization_id = null
--    where id = 'a42022a2-782c-4dc9-8fdc-d0ae62308cd9';
--   update auth.users set raw_app_meta_data = raw_app_meta_data - 'organization_id'
--    where id = 'a42022a2-782c-4dc9-8fdc-d0ae62308cd9';
--
-- The role is left alone. The profile says partner, app_metadata still says
-- partner_agent from before 27 Sep, when edits began to keep the two in step.

with target(id, organization_id) as (
  values ('a42022a2-782c-4dc9-8fdc-d0ae62308cd9'::uuid, 'bf266724-57da-487c-8cf4-06ef65c2b676'::uuid)
),
p as (
  update public.profiles pr
     set organization_id = t.organization_id
    from target t
   where pr.id = t.id
     and pr.role = 'partner'
     and pr.organization_id is null
     and exists (select 1 from public.organizations o where o.id = t.organization_id)
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
       (select count(*) from u) as logins_fixed;

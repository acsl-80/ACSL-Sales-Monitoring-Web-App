-- Phase 29, slice 1 (2026-09-14): the bench knows what is typed. Decision D53.
--
-- A typist could retype a stove that was already digitised and learn it only
-- at save, because the bench's one definition of "typed" was a sale against
-- the stove, and a sale exists only after the confirmation queue commits the
-- receipt. A receipt finished at the bench, a draft somebody else started,
-- and a sale made in the sales app all looked the same as "not typed yet"
-- until the next full page load.
--
-- One view answers, for every stove in stock, where its receipt stands:
--   typed      a live sale exists, whatever channel made it (the sales app,
--              the bench, the bulk import): typed_at, typed_by_name, typed_via
--   finished   no sale yet; the newest bench receipt is finished and waiting
--              to be confirmed
--   draft      no sale; the newest bench receipt is part typed (a draft, or
--              one refused at commit and back for rework)
--   untyped    nothing anywhere
-- The read function, the bench's open and save, and the partner records all
-- read this view rather than their own rule. Additive: one view and one
-- configuration key. Undo: drop the view.

create or replace view data_center.v_stove_typed as
select sb.stove_id,
       case
         when s.id is not null then 'typed'
         when r.status = 'valid' then 'finished'
         when r.status is not null and r.status <> 'committed' then 'draft'
         else 'untyped'
       end as typed_state,
       s.id::text as sale_id,
       (s.created_at at time zone 'UTC') as typed_at,
       case
         when s.id is null then null
         when rs.source = 'workbench' then 'bench'
         when rs.source is not null then 'import'
         else 'sales app'
       end as typed_via,
       case when s.id is null then null else coalesce(prs.full_name, ps.full_name) end as typed_by_name,
       r.status as row_status,
       r.last_edited_at,
       r.last_edited_by::text as last_edited_by,
       pr.full_name as last_edited_by_name
  from public.stove_ids_base sb
  left join public.sales s on s.id = sb.sale_id and s.is_archived is not true
  -- The newest bench receipt for the stove, whoever typed it.
  left join lateral (
    select r.status, r.last_edited_at, r.last_edited_by
      from data_center.import_rows r
      join data_center.import_batches b on b.id = r.batch_id
     where r.stove_serial_no = sb.stove_id
       and b.source = 'workbench'
       and b.state <> 'rolled_back'
     order by r.last_edited_at desc nulls last
     limit 1) r on true
  -- The import row the live sale came from, when it came from one.
  left join lateral (
    select b2.source, r2.last_edited_by
      from data_center.import_rows r2
      join data_center.import_batches b2 on b2.id = r2.batch_id
     where s.id is not null and r2.sale_id = s.id
     limit 1) rs on true
  left join public.profiles pr on pr.id = r.last_edited_by
  left join public.profiles prs on prs.id = rs.last_edited_by
  left join public.profiles ps on ps.id = s.created_by;

comment on view data_center.v_stove_typed is
  'Where a stove''s receipt stands (D53): typed (a live sale, from any channel), finished (a bench receipt waiting to be confirmed), draft (part typed), untyped. Read by the bench list, the bench open and save, and the partner records.';

grant select on data_center.v_stove_typed to service_role;

-- How often the bench re-reads its list, in seconds. Configuration, as the
-- board's refresh is.
insert into data_center.workflow_config (key, value, description) values
  ('bench.refresh_seconds', '60'::jsonb,
   'How often the digitisation bench re-reads its stove list, in seconds, so a receipt confirmed or a sale made elsewhere does not sit on a typist''s screen as not typed yet.')
on conflict (key) do nothing;

-- Readback: the states as they stand, and the key.
select typed_state, count(*)::int as stoves from data_center.v_stove_typed group by 1
union all
select 'config bench.refresh_seconds', (select (value #>> '{}')::int from data_center.workflow_config where key = 'bench.refresh_seconds')
order by 1;

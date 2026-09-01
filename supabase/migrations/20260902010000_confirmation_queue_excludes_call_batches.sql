-- ===========================================================================
-- The confirmation queue stops offering call batches to the receipt commit
--
-- `v_awaiting_confirmation` filtered on one thing: `b.state <> 'rolled_back'`.
-- Its stream split is `case when b.source = 'workbench' then 'workbench' else
-- 'bulk_import' end`, so EVERYTHING that is not the bench was bulk_import -
-- including 'call_center', which has been an allowed source since the first
-- migration.
--
-- A validated call batch has `valid` rows with `confirmed_at` null, which is
-- exactly what `awaiting` counts. So it appeared in the Confirm tab under
-- "Uploaded in bulk", and ConfirmationQueue.jsx's Confirm button calls
-- `dataCenterImport.commit(...)` - the RECEIPT commit. That reads each row's
-- `normalized` as a sale payload, and a call row's normalized is
-- `{values, attempts}`. Every row in the batch would come back an exception.
--
-- The view's own comment says it shows "both input streams". Both of those
-- streams end in records released to the sales app. A call batch releases
-- nothing there: it attaches call outcomes to sales that already exist, and
-- its undo removes those records without touching a sale. It was never one of
-- the two streams this view is about.
--
-- The edge function now refuses a foreign source outright, so this closes the
-- other half: the batch stops being offered at all, rather than being offered
-- and then refused.
--
-- Rollback:
--   restore the view from 20260821090000_data_center_workbench.sql
-- ===========================================================================

create or replace view data_center.v_awaiting_confirmation as
select
  b.id                                   as batch_id,
  case when b.source = 'workbench' then 'workbench' else 'bulk_import' end as stream,
  b.source,
  b.filename,
  b.organization_id,
  o.partner_name,
  b.uploaded_at,
  b.uploaded_by,
  up.full_name                           as uploaded_by_name,
  count(*) filter (where r.status = 'valid'  and r.confirmed_at is null) as awaiting,
  count(*) filter (where r.status = 'draft')                             as still_drafting,
  count(*) filter (where r.status = 'rejected')                          as refused,
  count(*) filter (where r.status = 'exception')                         as exceptions,
  count(*) filter (where r.confirmed_at is not null)                     as confirmed,
  count(*)                                                               as total_rows,
  max(r.last_edited_at)                                                  as last_worked_on,
  -- Who has typed into this batch. A workbench batch belongs to one person by
  -- construction; a file can be worked by several once corrections start.
  (select coalesce(json_agg(distinct ep.full_name) filter (where ep.full_name is not null), '[]')
     from data_center.import_rows r2
     left join public.profiles ep on ep.id = r2.last_edited_by
    where r2.batch_id = b.id)            as worked_by
from data_center.import_batches b
join data_center.import_rows r on r.batch_id = b.id
left join public.organizations o on o.id = b.organization_id
left join public.profiles up on up.id = b.uploaded_by
where b.state <> 'rolled_back'
  -- The one line this migration exists for.
  and b.source <> 'call_center'
group by b.id, b.source, b.filename, b.organization_id, o.partner_name,
         b.uploaded_at, b.uploaded_by, up.full_name;

comment on view data_center.v_awaiting_confirmation is
  'Both input streams that end in records released to the sales app - the bench and the receipt files - side by side: what has been entered, what is still being typed, and what is waiting on somebody to release it. Call-centre batches are excluded: they attach outcomes to sales that already exist and release nothing here.';

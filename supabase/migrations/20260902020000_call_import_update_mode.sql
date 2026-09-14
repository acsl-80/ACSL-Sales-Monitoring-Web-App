-- ===========================================================================
-- The call sheet becomes the working surface, not a one-time backlog dump
--
-- Until now the sheet only ever carried records nobody had called: the
-- download filtered on `hasCallRecord: false` and the import refused a stove
-- that already had a record. That made the sheet a single-use instrument. A
-- mis-typed outcome could only be corrected one record at a time in the app,
-- and 359 rows a week is not a number anybody corrects by hand.
--
-- `save_call_record` has always been an upsert, and has always accepted an
-- `expectedVersion` for optimistic locking (data-center-write/index.ts:532).
-- So refusing an existing record was a policy in the importer, never a limit
-- of the write path. This migration turns that policy into a setting and
-- gives the sheet the one column update mode needs.
--
-- WHY A VERSION COLUMN AND NOT A TIMESTAMP
--
-- The workflow is: download, fill in over days, upload. In that window other
-- agents work the same records in the app. Without a check, a days-old
-- spreadsheet silently overwrites live work, and `change_log` would hold the
-- only evidence. `call_records.version` already exists, is already bumped on
-- every save, and is already in the Table 2 projection that builds the sheet
-- (records-query.ts:210). Carrying it costs one locked column and turns a
-- silent overwrite into a named exception.
--
-- A blank version on a row whose stove already has a record is ALSO an
-- exception, deliberately. The safe direction is to refuse a sheet that
-- predates the feature rather than to guess that nothing has changed.
--
-- Rollback:
--   delete from data_center.workflow_config where key = 'call_import.update_existing';
--   -- and re-run 20260823030000 to restore the original column array.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------------
insert into data_center.workflow_config (key, value, description) values
  ('call_import.update_existing', 'true'::jsonb,
   'Whether an uploaded call sheet may update a record that already has one. When true the row must carry the Record Version it was downloaded with, and a version that no longer matches is an exception rather than an overwrite. When false the importer refuses every record that already exists, which is how this worked before update mode.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The column
--
-- Appended rather than slotted in beside the other locked columns. Position
-- is cosmetic and an array rebuild that reorders is a great deal more to get
-- wrong than one that concatenates. Guarded so re-running changes nothing,
-- which is the idiom 20260830090000 and 20260831090000 use on this array.
-- ---------------------------------------------------------------------------
update data_center.workflow_config c
   set value = c.value || jsonb_build_array(
         jsonb_build_object(
           'field',  'recordVersion',
           'header', 'Record Version',
           'locked', true,
           'help',   'Filled in already. Do not change it.'
         ))
 where c.key = 'call_centre.sheet_columns'
   and not exists (
     select 1 from jsonb_array_elements(c.value) as e
      where e ->> 'field' = 'recordVersion'
   );

-- ---------------------------------------------------------------------------
-- 3. The guidance row's own defect, in the data as well as the code
--
-- `looksLikeGuidance` in lib/xlsx.ts bails the moment the Stove ID cell is
-- non-empty, and this sheet put the stove column's help text in exactly that
-- cell - so every xlsx round trip staged the guidance row as data, uppercased
-- its help into a serial, and produced one exception nobody could fix.
--
-- The detector is fixed properly in the same change; this is the other half.
-- The long sentence that used to sit in the Stove ID cell said nothing the
-- word "locked" does not already say, and it is what made the row look like
-- data to anything reading the first cell.
-- ---------------------------------------------------------------------------
update data_center.workflow_config c
   set value = (
         select jsonb_agg(
                  case
                    when e ->> 'field' = 'stoveSerialNo'
                      then e || jsonb_build_object('help', 'Filled in already. Do not change it.')
                    else e
                  end
                  order by ord)
           from jsonb_array_elements(c.value) with ordinality as t(e, ord)
       )
 where c.key = 'call_centre.sheet_columns'
   and exists (
     select 1 from jsonb_array_elements(c.value) as e
      where e ->> 'field' = 'stoveSerialNo'
        and length(coalesce(e ->> 'help', '')) > 40
   );

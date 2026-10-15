-- Phone number and buyer rule, decision 2: confirm on the register the open
-- rows of sales a call already fully verified, on numbers where the names
-- differ.
--
-- Plan: docs/plans/phone-and-buyer-rule.md (decision 2, settled 2026-10-15).
-- This DOES move the creditable count: each sale it releases is counted as
-- creditable from the next analysis run. Which rows, and why, is in the dry
-- run's header. Same customer twice is never confirmed here.
--
-- WHEN: after the release and after phone-buyer-kind-backfill.sql.
--
-- HOW:
--   1. Run phone-buyer-confirm-verified-dryrun.sql. Note rows_to_confirm and
--      sales_released.
--   2. Run this whole file in the SQL editor. One statement after the
--      snapshot table, so it lands whole or not at all. Its result row:
--        rows_matched      should equal the dry run's rows_to_confirm
--        rows_confirmed    equal to rows_matched, less any a call confirmed
--                          in between
--        rows_snapshotted  equal to rows_confirmed (lower only when run again
--                          after an undo: the first snapshot is kept)
--   3. Proof it landed (expect 0): run the dry run again; rows_to_confirm.
--   4. The next analysis run (data_center.compute_analysis) moves the counts.
--
-- WHAT IT WRITES: confirmed = true, updated_at = now(), and the note below
-- where the row had none. source and kind are left alone, so the register
-- still says how the number was found. The audit trigger records each change
-- in data_center.change_log with no actor.
--
-- SAFE TO RUN TWICE: a confirmed row is not selected again.
--
-- UNDO: phone-buyer-confirm-verified-undo.sql puts back confirmed, note,
-- updated_at and updated_by from the snapshot table this file fills. Then
-- rerun the analysis.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists data_center.shared_phones_confirm_backfill (
  id uuid primary key,
  confirmed_before boolean not null,
  note_before text,
  updated_at_before timestamptz,
  updated_by_before uuid,
  taken_at timestamptz not null default now()
);
comment on table data_center.shared_phones_confirm_backfill is
  'Snapshot for phone-buyer-confirm-verified.sql: each register row as it was before decision 2 confirmed it. Read by the undo script. Drop once the confirmation is accepted.';
alter table data_center.shared_phones_confirm_backfill enable row level security;
revoke all on data_center.shared_phones_confirm_backfill from public, anon, authenticated;

with
-- >>> confirm
-- >>> mark
ws(c) as (values ('[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')),
titles(t) as (values (array['mr', 'mrs', 'miss', 'ms', 'dr', 'alhaji', 'alhaja', 'hajia', 'hajiya',
                            'malam', 'mallam', 'chief', 'madam'])),
live as (
  select s.id,
         s.end_user_first_name as f, s.end_user_surname as su, s.end_user_name as j,
         cr.corrected_end_user_name as cn,
         regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') as d_written,
         regexp_replace(coalesce(nullif(btrim(cr.corrected_phone), ''), ''), '[^0-9]', '', 'g') as d_corrected
    from public.sales s
    left join data_center.call_records cr on cr.sale_id = s.id
   where s.is_archived is not true
),
raw as (
  select l.id,
         case when length(l.d_corrected) >= 10 then right(l.d_corrected, 10)
              when length(l.d_written) >= 10 then right(l.d_written, 10)
         end as tail,
         case when regexp_replace(coalesce(l.cn, ''), w.c, '', 'g') <> '' then l.cn
              when regexp_replace(coalesce(l.f, ''), w.c, '', 'g') <> ''
                or regexp_replace(coalesce(l.su, ''), w.c, '', 'g') <> ''
                then concat_ws(' ',
                       case when regexp_replace(coalesce(l.f, ''), w.c, '', 'g') <> '' then l.f end,
                       case when regexp_replace(coalesce(l.su, ''), w.c, '', 'g') <> '' then l.su end)
              else coalesce(l.j, '')
         end as name
    from live l cross join ws w
),
keyed as (
  select r.id, r.tail,
         (select string_agg(x.w, ' ' order by x.w collate "C")
            from unnest(string_to_array(
                   regexp_replace(
                     regexp_replace(
                       translate(regexp_replace(r.name, '\[[^\]]*\]|\([^)]*\)', ' ', 'g'),
                                 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
                       replace(w.c, ']', ',/]') || '+', ' ', 'g'),
                     '[^a-z ]', '', 'g'),
                   ' ')) as x(w)
           where x.w <> '' and x.w <> all (t.t)) as name_key
    from raw r cross join ws w cross join titles t
),
mark as (
  select sp.id, sp.phone_tail, sp.sale_id
    from data_center.shared_phones sp
    join keyed k on k.id = sp.sale_id
   where k.tail is not null and k.name_key is not null
     and exists (select 1
                   from data_center.shared_phones sp2
                   join keyed k2 on k2.id = sp2.sale_id
                  where sp2.phone_tail = sp.phone_tail
                    and sp2.sale_id <> sp.sale_id
                    and k2.tail = k.tail
                    and k2.name_key = k.name_key)
)
-- <<< mark
-- The analysis's own completeness rule, stored as text
-- (data_center.completeness_predicate), run inside this one statement so
-- the script never carries a copy that drifts from it.
, complete(id) as (
  select x.id
    from xmltable('/table/row'
           passing query_to_xml(
             format('select s.id from public.sales s where s.is_archived is not true and (%s)',
                    data_center.completeness_predicate('s')),
             false, false, '')
           columns id uuid path 'id') as x
)
-- Open rows of sales that pass every other gate of the creditable count, on
-- numbers where the names differ. A repeat (kind same_buyer, or one the mark
-- block finds) is left for a call about the second stove.
, confirm as (
  select sp.id, sp.phone_tail, sp.sale_id
    from data_center.shared_phones sp
    join public.sales s on s.id = sp.sale_id and s.is_archived is not true
    join data_center.call_records cr on cr.sale_id = s.id
    join complete c on c.id = s.id
   where sp.confirmed is false
     and sp.kind <> 'same_buyer'
     and not exists (select 1 from mark m where m.id = sp.id)
     and cr.verification_outcome = 'fully_verified'
     and cr.serial_unconfirmed_at is null
     and coalesce(cr.answers ->> 'double_counting', 'only_stove') = 'only_stove'
     and (cr.correction_requested_at is null or cr.correction_resolved_at is not null)
)
-- <<< confirm
-- Locked first, in sale id order as every register writer takes them. A row a
-- call confirms while this waits is re-read under the lock and drops out.
, locked as (
  select sp.id, sp.confirmed, sp.note, sp.updated_at, sp.updated_by
    from data_center.shared_phones sp
    join confirm c on c.id = sp.id
   where sp.confirmed is false
   order by sp.sale_id
     for update of sp
)
, snap as (
  insert into data_center.shared_phones_confirm_backfill
         (id, confirmed_before, note_before, updated_at_before, updated_by_before)
  select l.id, l.confirmed, l.note, l.updated_at, l.updated_by from locked l
  on conflict (id) do nothing
  returning id
)
, upd as (
  update data_center.shared_phones sp
     set confirmed = true,
         note = coalesce(sp.note, 'Confirmed from a full verification call (decision 2, 2026-10-15)'),
         updated_at = now()
    from locked l
   where sp.id = l.id
  returning sp.id
)
select (select count(*) from confirm) as rows_matched,
       (select count(*) from upd) as rows_confirmed,
       (select count(*) from snap) as rows_snapshotted;

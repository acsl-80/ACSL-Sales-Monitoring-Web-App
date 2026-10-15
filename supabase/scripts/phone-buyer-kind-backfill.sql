-- Phone number and buyer rule, Phase 5: mark the existing repeats on the call
-- centre's register as the same customer twice (kind 'same_buyer').
--
-- Plan: docs/plans/phone-and-buyer-rule.md (Phase 5). Changes a label only:
-- data_center.compute_analysis holds a sale on any unconfirmed row whatever its
-- kind, so no sale moves in or out of the creditable count. The label decides
-- the order of the call centre's list, its "Same customer twice only" filter and
-- the "Same customer recorded twice" line on Needs a decision.
--
-- WHEN: after migration 20261014120000 (it adds the kind column) and after the
-- Phase 4 functions are live. From then on create-sale marks every new repeat
-- itself, so this runs once and covers everything that came before.
--
-- HOW:
--   1. Run phone-buyer-kind-backfill-dryrun.sql. Note rows_to_mark.
--   2. Run this whole file in the SQL editor. It is one statement after the
--      snapshot table, so it lands whole or not at all. Its result row:
--        rows_matched      should equal the dry run's rows_to_mark
--        rows_marked       rows_matched less any create-sale already marked
--        rows_snapshotted  equal to rows_marked (lower only when run again
--                          after an undo: the first snapshot is kept)
--   3. Proof it landed (expect rows_left = 0):
--        with
--        <the mark block below, from its >>> line to its <<< line>
--        select count(*) as rows_left
--          from mark m join data_center.shared_phones sp on sp.id = m.id
--         where sp.kind <> 'same_buyer';
--      Or the short form: select kind, count(*) from data_center.shared_phones
--      group by kind;  (same_buyer about 416 on 2026-10-15)
--
-- SAFE TO RUN TWICE: a row already 'same_buyer' is not touched and not
-- snapshotted again. updated_at is left alone (a label, not activity), so the
-- list's "last touched" order does not jump. The audit trigger records each
-- change in data_center.change_log with no actor.
--
-- UNDO: phone-buyer-kind-backfill-undo.sql puts back the kind each row had,
-- from the snapshot table this file fills.
--
-- Which rows: see the dry run's header. The block between >>> and <<< is the
-- same text as the dry run's; e2e/host-phone-buyer-backfill.spec.ts checks it.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists data_center.shared_phones_kind_backfill (
  id uuid primary key,
  kind_before text not null,
  taken_at timestamptz not null default now()
);
comment on table data_center.shared_phones_kind_backfill is
  'Snapshot for phone-buyer-kind-backfill.sql: the kind each register row had before it was marked same_buyer. Read by the undo script. Drop once the backfill is accepted.';
alter table data_center.shared_phones_kind_backfill enable row level security;
revoke all on data_center.shared_phones_kind_backfill from public, anon, authenticated;

with
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
-- The rows to change, locked first, in sale id order as every register writer
-- takes them. A row create-sale marks while this waits is re-read under the
-- lock and drops out, so the snapshot never records a kind it did not change.
, locked as (
  select sp.id, sp.kind
    from data_center.shared_phones sp
    join mark m on m.id = sp.id
   where sp.kind <> 'same_buyer'
   order by sp.sale_id
     for update of sp
)
, snap as (
  insert into data_center.shared_phones_kind_backfill (id, kind_before)
  select l.id, l.kind from locked l
  on conflict (id) do nothing
  returning id
)
, upd as (
  update data_center.shared_phones sp
     set kind = 'same_buyer'
    from locked l
   where sp.id = l.id
  returning sp.id
)
select (select count(*) from mark) as rows_matched,
       (select count(*) from upd) as rows_marked,
       (select count(*) from snap) as rows_snapshotted;

-- Phone number and buyer rule, decision 2: which open register rows the
-- confirm script would confirm. Read only; nothing here writes.
--
-- Plan: docs/plans/phone-and-buyer-rule.md (decision 2, settled 2026-10-15).
-- A sale fully verified on a call, with every other gate of the creditable
-- count passed (data_center.compute_analysis: complete, stove ID confirmed,
-- "only stove" in the household, no open correction), is held only because its
-- shared number was never confirmed on the register. Where the names on the
-- number differ, the call already answered the question, so its open row is
-- confirmed. Where the same customer appears twice the row stays open for a
-- call about the second stove.
--
-- Run after the release (it reads the kind column) and after
-- phone-buyer-kind-backfill.sql. The block between the >>> and <<< lines is
-- repeated in phone-buyer-confirm-verified.sql; its first part is the kind
-- backfill's mark block. e2e/host-phone-buyer-confirm.spec.ts checks both.
--
-- sales_released counts the sales left with no open row once these are
-- confirmed: the ones whose creditable status changes. numbers_closed counts
-- the numbers with every row confirmed afterwards.
--
-- Expect (production, 2026-10-15, before the release): about 104 sales,
-- each of which leaves the hold and becomes creditable at the next analysis
-- run. The count moves as calls are made.

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
select (select count(*) from confirm) as rows_to_confirm,
       (select count(distinct sale_id) from confirm) as sales,
       (select count(distinct phone_tail) from confirm) as numbers,
       (select count(distinct c.sale_id) from confirm c
         where not exists (select 1 from data_center.shared_phones sp
                            where sp.sale_id = c.sale_id and sp.confirmed is false
                              and sp.id not in (select id from confirm))) as sales_released,
       (select count(distinct c.phone_tail) from confirm c
         where not exists (select 1 from data_center.shared_phones sp
                            where sp.phone_tail = c.phone_tail and sp.confirmed is false
                              and sp.id not in (select id from confirm))) as numbers_closed;

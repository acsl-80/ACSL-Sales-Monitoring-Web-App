-- Phone number and buyer rule, Phase 5: which register rows the kind backfill
-- would mark as the same customer twice. Read only; nothing here writes.
--
-- Plan: docs/plans/phone-and-buyer-rule.md (Phase 5). The backfill itself is
-- phone-buyer-kind-backfill.sql; run this first and compare its counts with
-- the backfill's own report.
--
-- What it marks. A register row (number T, sale S) is 'same_buyer' when another
-- register row on T belongs to a sale with the same buyer key as S. The key is
-- the one in supabase/functions/_shared/buyerKey.ts (last ten digits, and the
-- name reduced: brackets dropped, ASCII lower case, punctuation removed, titles
-- from buyer-key-rules.json version 2026-10-14.1 dropped, words sorted), with
-- the call centre's corrections applied: a corrected phone or name replaces the
-- written one, because the call is the fact. Archived sales are left out.
--
-- The block between the >>> and <<< lines is repeated, character for character,
-- in phone-buyer-kind-backfill.sql. e2e/host-phone-buyer-backfill.spec.ts checks
-- that the two copies match and that this one agrees with buyerKey.ts.
--
-- Expect (production, 2026-10-15): 416 rows to mark on 166 numbers; 954 rows in
-- the register. The counts move as sales arrive.

with
-- >>> mark
ws(c) as (values ('[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')),
titles(t) as (values (array['mr', 'mrs', 'miss', 'ms', 'dr', 'alhaji', 'alhaja', 'hajia', 'hajiya',
                            'malam', 'mallam', 'chief', 'madam'])),
live as (
  select s.id,
         s.end_user_first_name as f, s.end_user_surname as su, s.end_user_name as j,
         nullif(btrim(cr.corrected_end_user_name), '') as cn,
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
         case when l.cn is not null then l.cn
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
select (select count(*) from data_center.shared_phones) as register_rows,
       (select count(*) from mark) as rows_to_mark,
       (select count(distinct phone_tail) from mark) as numbers_to_mark,
       (select count(distinct sale_id) from mark) as sales_to_mark,
       (select count(*) from mark m join data_center.shared_phones sp on sp.id = m.id
         where sp.confirmed) as of_which_confirmed;

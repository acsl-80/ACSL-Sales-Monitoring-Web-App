-- Phase 28, S1b: what the 2026-09-11 call-history repair would touch (D48).
-- Read-only. Run on the sandbox and on production before the merge word; the
-- output goes in the PR. Nothing here writes.

-- 1. Who the sheet names would link to, by the migration's own rule.
with aliases(agent_key, spelt) as (values ('kharriyah', 'khairiyyah')),
names as (
  select o.value as agent_key, o.label as agent_label, lower(coalesce(a.spelt, o.value)) as first_name
    from data_center.option_values o
    left join aliases a on a.agent_key = o.value
   where o.list_key = 'agent_name'
)
select n.agent_label,
       (select count(*) from data_center.module_access m join public.profiles p on p.id = m.user_id
         where m.access_role in ('call_agent', 'editor') and lower(p.full_name) like '%' || n.first_name || '%') as logins_matching,
       (select string_agg(p.full_name, '; ') from data_center.module_access m join public.profiles p on p.id = m.user_id
         where m.access_role in ('call_agent', 'editor') and lower(p.full_name) like '%' || n.first_name || '%') as would_link_to,
       (select count(*) from data_center.call_attempts a join data_center.option_values o on o.id = a.agent_id
         where o.value = n.agent_key) as attempts_tagged,
       (select count(*) from data_center.call_records cr join data_center.option_values o on o.id = cr.call_agent_id
         where o.value = n.agent_key) as records_tagged
  from names n
 order by attempts_tagged desc;

-- 2. Sheet attempts: how each would resolve.
select count(*) filter (where note = 'Imported from the call-centre sheet') as sheet_attempts,
       count(*) filter (where note = 'Imported from the call-centre sheet' and a.agent_id is not null) as by_own_tag,
       count(*) filter (where note = 'Imported from the call-centre sheet' and a.agent_id is null and cr.call_agent_id is not null) as by_record_tag,
       count(*) filter (where note = 'Imported from the call-centre sheet' and a.agent_id is null and cr.call_agent_id is null) as for_nobody,
       count(*) filter (where note is distinct from 'Imported from the call-centre sheet') as form_attempts
  from data_center.call_attempts a
  join data_center.call_records cr on cr.sale_id = a.sale_id;

-- 3. Repair one: concluded records with no call behind them.
select cr.verification_outcome, count(*) as records, min(cr.updated_at)::date as earliest, max(cr.updated_at)::date as latest
  from data_center.call_records cr
 where cr.verification_outcome in ('fully_verified', 'partially_verified', 'unreachable')
   and coalesce(cr.attempt_count, 0) = 0
   and not exists (select 1 from data_center.call_attempts a where a.sale_id = cr.sale_id)
 group by 1 order by 1;

-- 4. Repair two: concluded records whose calls carry no outcome.
select cr.verification_outcome, count(*) as records,
       count(*) filter (where cr.call_outcome_id is null) as record_outcome_blank
  from data_center.call_records cr
 where cr.verification_outcome in ('fully_verified', 'partially_verified', 'unreachable')
   and coalesce(cr.attempt_count, 0) > 0
   and not exists (select 1 from data_center.call_attempts a where a.sale_id = cr.sale_id and a.outcome_id is not null)
 group by 1 order by 1;

-- 5. Attempts per person per month, as the board would count them after the
-- link (own tag, then the record's tag, then the login; untagged sheet calls
-- for nobody). Compare with the same query on created_by to see what moves.
with aliases(agent_key, spelt) as (values ('kharriyah', 'khairiyyah')),
links as (
  select o.value as agent_key,
         (select (array_agg(p.id))[1] from data_center.module_access m join public.profiles p on p.id = m.user_id
           where m.access_role in ('call_agent', 'editor')
             and lower(p.full_name) like '%' || lower(coalesce(al.spelt, o.value)) || '%'
          having count(*) = 1) as user_id
    from data_center.option_values o
    left join aliases al on al.agent_key = o.value
   where o.list_key = 'agent_name'
),
resolved as (
  select a.attempted_at,
         coalesce(la.user_id, lr.user_id,
                  case when a.note = 'Imported from the call-centre sheet' then null else a.created_by end) as agent_user_id
    from data_center.call_attempts a
    left join data_center.option_values oa on oa.id = a.agent_id
    left join links la on la.agent_key = oa.value and la.user_id is not null
    left join data_center.call_records cr on cr.sale_id = a.sale_id
    left join data_center.option_values ocr on ocr.id = cr.call_agent_id
    left join links lr on lr.agent_key = ocr.value and lr.user_id is not null
)
select to_char(date_trunc('month', r.attempted_at), 'YYYY-MM') as month,
       coalesce(p.full_name, '(nobody)') as person,
       count(*) as attempts
  from resolved r
  left join public.profiles p on p.id = r.agent_user_id
 group by 1, 2
 order by 1, 3 desc;

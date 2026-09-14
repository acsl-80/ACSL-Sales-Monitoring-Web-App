-- Phase 28, S1b: nothing lost. The call history attributed to the people who
-- made the calls, and the records the sheets left half-written repaired
-- (D47, D48).
--
-- The July and August call sheets were imported under one login. The board,
-- the feed, the agent page and the call history read `created_by` and
-- `updated_by`, so those months showed as nobody's. The sheets did name the
-- agent, as a registry value: linked to a login, the history comes back.
-- Every step is additive; the repairs keep their prior values in a backup
-- table so the undo is one delete and one update.

-- 1. Where an attempt came from ------------------------------------------------
alter table data_center.call_attempts
  add column if not exists source text
    check (source in ('form', 'sheet', 'reconciled'));

update data_center.call_attempts
   set source = case when note = 'Imported from the call-centre sheet' then 'sheet' else 'form' end
 where source is null;

alter table data_center.call_attempts alter column source set default 'form';

comment on column data_center.call_attempts.source is
  'form: logged on the call form. sheet: brought in from a paper call sheet by the import. reconciled: written by the 2026-09-11 repair from a saved verdict that had no call behind it (D48).';

-- 2. The sheet's agent names, linked to logins ---------------------------------
create table if not exists data_center.call_agent_links (
  agent_key   text primary key,
  agent_label text not null,
  user_id     uuid references public.profiles (id) on delete set null,
  no_account  boolean not null default false,
  linked_at   timestamptz,
  linked_by   uuid references public.profiles (id) on delete set null
);

comment on table data_center.call_agent_links is
  'A call sheet''s agent name (the agent_name registry value) to the login it means. The sheets named agents by first name; linked here, their calls count for them on the board, the agent page, My calls and the feed (D47). Edited on Settings. Nothing here is code.';

create index if not exists call_agent_links_user_idx
  on data_center.call_agent_links (user_id) where user_id is not null;

grant select, insert, update, delete on data_center.call_agent_links to service_role;

-- Seed: every agent_name value, linked where exactly one call-centre login
-- (module access call_agent or editor) carries that first name. One spelling
-- the sheets used differently is mapped as data. Anything ambiguous or absent
-- stays unlinked for Settings.
with aliases(agent_key, spelt) as (
  values ('kharriyah', 'khairiyyah')
),
names as (
  select o.value as agent_key, o.label as agent_label,
         lower(coalesce(a.spelt, o.value)) as first_name
    from data_center.option_values o
    left join aliases a on a.agent_key = o.value
   where o.list_key = 'agent_name'
),
matches as (
  select n.agent_key, n.agent_label,
         (select (array_agg(p.id))[1]
            from data_center.module_access m
            join public.profiles p on p.id = m.user_id
           where m.access_role in ('call_agent', 'editor')
             and lower(p.full_name) like '%' || n.first_name || '%'
           having count(*) = 1) as user_id
    from names n
)
insert into data_center.call_agent_links (agent_key, agent_label, user_id, linked_at, linked_by)
select agent_key, agent_label, user_id,
       case when user_id is not null then now() end,
       null
  from matches
on conflict (agent_key) do nothing;

-- 3. Who an attempt counts for --------------------------------------------------
create or replace view data_center.v_call_attempts_resolved as
-- Columns listed, not a.*: a view written as * freezes at creation and the
-- next column on call_attempts would not flow through (the resolved-values
-- view taught that in slice 1).
select a.id, a.sale_id, a.attempt_no, a.attempted_at, a.outcome_id, a.agent_id,
       a.answered_by_id, a.note, a.created_at, a.created_by, a.callback_at, a.source,
       coalesce(
         la.user_id,
         case when a.source = 'sheet' then lr.user_id end,
         case when a.source = 'sheet' then null else a.created_by end
       ) as agent_user_id,
       oa.label as agent_tag,
       ocr.label as record_agent_tag
  from data_center.call_attempts a
  left join data_center.option_values oa on oa.id = a.agent_id
  left join data_center.call_agent_links la on la.agent_key = oa.value and la.user_id is not null
  left join data_center.call_records cr on cr.sale_id = a.sale_id
  left join data_center.option_values ocr on ocr.id = cr.call_agent_id
  left join data_center.call_agent_links lr on lr.agent_key = ocr.value and lr.user_id is not null;

comment on view data_center.v_call_attempts_resolved is
  'Every call attempt with agent_user_id, the login it counts for (D47): the attempt''s own sheet tag linked to a login. For a sheet call with no tag of its own, the record''s tag (a sheet row named one agent for all its calls). For a form call, the login that logged it. A sheet call with no tag anywhere counts for nobody rather than for the importer.';

grant select on data_center.v_call_attempts_resolved to service_role;

-- 4. The views that carry the person -------------------------------------------
create or replace view data_center.v_call_center as
select
  v.*,
  cr.verification_outcome,
  cr.corrected_phone,
  cr.corrected_alt_phone,
  cr.corrected_end_user_name,
  cr.corrected_address,
  cr.corrected_state,
  cr.corrected_lga,
  cr.ward,
  cr.landmark,
  cr.stated_serial,
  cr.answers,
  cr.other_comments,
  cr.version              as call_record_version,
  cr.updated_at           as call_record_updated_at,
  co.label                as call_outcome,
  ca.label                as call_agent,
  att.call_date_1,
  att.call_date_2,
  att.call_date_3,
  coalesce(cr.attempt_count, 0) as attempt_count,
  cr.last_attempt_at,
  coalesce(
    cx.state,
    case
      when cr.correction_requested_at is null then 'none'
      when cr.correction_resolved_at is null  then 'open'
      else 'resolved'
    end
  ) as correction_state,
  cr.correction_requested_at,
  cr.correction_resolved_at,
  crr.label as correction_reason,
  cr.correction_note,
  case
    when cr.stated_serial is null or v.stove_serial_no is null then null
    else upper(trim(cr.stated_serial)) = upper(trim(v.stove_serial_no))
  end as serial_matches,
  case
    when cr.corrected_phone is null or v.primary_phone is null then null
    else right(regexp_replace(cr.corrected_phone, '\D', '', 'g'), 10)
       <> right(regexp_replace(v.primary_phone,   '\D', '', 'g'), 10)
  end as phone_was_corrected,
  (cr.sale_id is not null) as has_call_record,
  -- Phase 28, D41: one word for where the record stands, from the same
  -- three facts the columns above already carry.
  data_center.record_standing(
    cr.verification_outcome,
    cr.attempt_count,
    coalesce(
      cx.state,
      case
        when cr.correction_requested_at is null then 'none'
        when cr.correction_resolved_at is null  then 'open'
        else 'resolved'
      end
    )
  ) as standing,
  -- Phase 28, D47: the person the record's conclusion counts for. The sheet's
  -- agent tag, linked to a login, wins; else the login that saved it.
  coalesce(lk.user_id, cr.updated_by) as agent_user_id
from data_center.v_sold_stoves v
left join data_center.call_records cr  on cr.sale_id = v.sale_id
left join data_center.option_values co on co.id      = cr.call_outcome_id
left join data_center.option_values ca on ca.id      = cr.call_agent_id
left join data_center.call_agent_links lk on lk.agent_key = ca.value and lk.user_id is not null
left join data_center.option_values crr on crr.id    = cr.correction_reason_id
left join lateral (
  select
    max(a.attempted_at) filter (where a.attempt_no = 1)::date as call_date_1,
    max(a.attempted_at) filter (where a.attempt_no = 2)::date as call_date_2,
    max(a.attempted_at) filter (where a.attempt_no = 3)::date as call_date_3
  from data_center.call_attempts a
  where a.sale_id = cr.sale_id
) att on true
left join lateral (
  select c.state
    from data_center.corrections c
   where c.sale_id = cr.sale_id
   order by c.seq desc
   limit 1
) cx on true;

comment on view data_center.v_call_center is
  'Table 2. Table 1 plus what the call centre added. correction_state is none, open, fixed or resolved, read from the newest correction episode. standing is record_standing() over the same facts (D41). agent_user_id is the login the conclusion counts for (D47).';

drop view if exists data_center.v_call_center_resolved;
create view data_center.v_call_center_resolved as
select v.*,

       -- A correction is only a correction when somebody typed something.
       -- nullif on the trimmed value: an agent who tabbed through a field and
       -- left a space has not corrected anything.
       coalesce(nullif(btrim(v.corrected_end_user_name), ''), v.end_user_name)
         as resolved_end_user_name,
       coalesce(nullif(btrim(v.corrected_phone), ''), v.primary_phone)
         as resolved_phone,
       coalesce(nullif(btrim(v.corrected_alt_phone), ''), v.alternative_phone)
         as resolved_alt_phone,
       coalesce(nullif(btrim(v.corrected_address), ''), v.user_residential_address)
         as resolved_address,
       coalesce(nullif(btrim(v.corrected_state), ''), v.user_state)
         as resolved_state,
       coalesce(nullif(btrim(v.corrected_lga), ''), v.user_lga)
         as resolved_lga,

       -- Whether anything was corrected at all, so a surface can mark the
       -- record without comparing six pairs of strings itself.
       (nullif(btrim(v.corrected_end_user_name), '') is not null
        or nullif(btrim(v.corrected_phone), '') is not null
        or nullif(btrim(v.corrected_alt_phone), '') is not null
        or nullif(btrim(v.corrected_address), '') is not null
        or nullif(btrim(v.corrected_state), '') is not null
        or nullif(btrim(v.corrected_lga), '') is not null) as was_corrected

  from data_center.v_call_center v;

comment on view data_center.v_call_center_resolved is
  'Table 2 with the call centre''s corrections applied: one answer to what a buyer is called and where they live. Carries standing (D41) and agent_user_id (D47).';

grant select on data_center.v_call_center_resolved to service_role;

create or replace view data_center.v_assignment_log as
select
  b.id as batch_id,
  b.organization_id,
  o.partner_name,
  b.assigned_to as agent_id,
  ap.full_name as agent_name,
  b.assigned_at,
  b.state as batch_state,
  b.size as batch_size,
  b.last_activity_at,
  b.reclaimed_at,
  b.reclaim_reason,

  i.sale_id,
  i.position,
  i.is_active,

  s.stove_serial_no,
  s.sales_date,

  cr.verification_outcome,
  co.label as call_outcome,
  cr.attempt_count,
  cr.updated_at as record_updated_at,

  -- The number that would have been rung. There is no column recording the
  -- digits actually dialled, so this is the number the record carried:
  -- corrected where an agent corrected it, as typed otherwise. Saying which
  -- one it is beats inventing a field nothing writes.
  coalesce(cr.corrected_phone, s.phone) as number_on_record,

  la.attempted_at as last_attempt_at,
  ao.label as last_attempt_outcome,
  la.note as last_attempt_note,
  lp.full_name as last_attempt_by,
  -- Phase 28, D41.
  data_center.record_standing(
    cr.verification_outcome,
    cr.attempt_count,
    coalesce(
      cxs.state,
      case
        when cr.correction_requested_at is null then 'none'
        when cr.correction_resolved_at is null  then 'open'
        else 'resolved'
      end
    )
  ) as standing
from data_center.assignment_batches b
join public.organizations o on o.id = b.organization_id
left join public.profiles ap on ap.id = b.assigned_to
join data_center.assignment_items i on i.batch_id = b.id
join public.sales s on s.id = i.sale_id
left join data_center.call_records cr on cr.sale_id = i.sale_id
left join data_center.option_values co on co.id = cr.call_outcome_id
left join lateral (
  -- Phase 28, D47: the newest attempt, with the person it counts for.
  select a.attempted_at, a.outcome_id, a.note, a.agent_user_id
    from data_center.v_call_attempts_resolved a
   where a.sale_id = i.sale_id
   order by a.attempted_at desc
   limit 1
) la on true
left join data_center.option_values ao on ao.id = la.outcome_id
left join public.profiles lp on lp.id = la.agent_user_id
left join lateral (
  select c.state
    from data_center.corrections c
   where c.sale_id = i.sale_id
   order by c.seq desc
   limit 1
) cxs on true;

create or replace view data_center.v_agent_activity as
select
  m.user_id as agent_id,
  d.saved_at        as last_draft_saved_at,
  d.sale_id         as last_draft_sale_id,
  ds.stove_serial_no as last_draft_serial,
  b.last_batch_activity_at,
  a.last_attempt_at,
  coalesce(a.attempts_today, 0) as attempts_today,
  greatest(d.saved_at, b.last_batch_activity_at, a.last_attempt_at) as last_seen_at
from data_center.module_access m
cross join (
  select coalesce((select value #>> '{}' from data_center.workflow_config
                    where key = 'call_centre.timezone'), 'Africa/Lagos') as tz
) cfg
left join lateral (
  select x.sale_id, x.saved_at
    from data_center.call_drafts x
   where x.saved_by = m.user_id
   order by x.saved_at desc
   limit 1
) d on true
left join public.sales ds on ds.id = d.sale_id
left join lateral (
  select max(x.last_activity_at) as last_batch_activity_at
    from data_center.assignment_batches x
   where x.assigned_to = m.user_id
) b on true
left join lateral (
  -- One pass over this agent's attempts: the newest, and how many fell on
  -- today where the call centre sits, not on UTC's today.
  select max(x.attempted_at) as last_attempt_at,
         count(*) filter (where timezone(cfg.tz, x.attempted_at)::date = timezone(cfg.tz, now())::date)::int as attempts_today
    from data_center.v_call_attempts_resolved x
   where x.agent_user_id = m.user_id
) a on true
where m.access_role in ('call_agent', 'editor');

-- 5. The repairs, with their undo kept -------------------------------------------
create table if not exists data_center.call_history_repair_20260911 (
  attempt_id          bigint,
  sale_id             uuid not null,
  inserted            boolean not null,
  old_outcome_id      uuid,
  old_call_outcome_id uuid,
  repaired_at         timestamptz not null default now()
);

comment on table data_center.call_history_repair_20260911 is
  'What the 2026-09-11 repair changed (D48). Undo: delete the attempts where inserted, and set outcome_id and call_outcome_id back from the old columns where not.';

-- Repair one: a concluded record with no call behind it gets the one call
-- its verdict implies, dated and attributed from the record.
with verdict_outcome as (
  -- The verdict's outcome, for a record whose sheet filled Verification and
  -- left Call Outcome blank.
  select v.verdict, o.id as outcome_id
    from (values ('fully_verified', 'verified'),
                 ('partially_verified', 'partially_verified'),
                 ('unreachable', 'unreachable')) as v(verdict, value)
    join data_center.option_values o on o.list_key = 'call_outcome' and o.value = v.value
),
candidates as (
  select cr.sale_id, cr.updated_at, cr.updated_by, cr.call_agent_id, vo.outcome_id
    from data_center.call_records cr
    join verdict_outcome vo on vo.verdict = cr.verification_outcome
   where coalesce(cr.attempt_count, 0) = 0
     and not exists (select 1 from data_center.call_attempts a where a.sale_id = cr.sale_id)
),
inserted as (
  insert into data_center.call_attempts
    (sale_id, attempt_no, attempted_at, outcome_id, agent_id, answered_by_id, note, created_by, source)
  select sale_id, 1, updated_at, outcome_id, call_agent_id, null,
         'Recorded from the saved verdict; no call was logged at the time',
         updated_by, 'reconciled'
    from candidates
  returning id, sale_id
)
insert into data_center.call_history_repair_20260911 (attempt_id, sale_id, inserted)
select id, sale_id, true from inserted;

-- Repair two: a concluded record whose calls carry no outcome gets the
-- verdict's outcome on its newest call, and on the record.
with verdict_outcome as (
  -- The verdict's outcome, for a record whose sheet filled Verification and
  -- left Call Outcome blank.
  select v.verdict, o.id as outcome_id
    from (values ('fully_verified', 'verified'),
                 ('partially_verified', 'partially_verified'),
                 ('unreachable', 'unreachable')) as v(verdict, value)
    join data_center.option_values o on o.list_key = 'call_outcome' and o.value = v.value
),
candidates as (
  select cr.sale_id, cr.call_outcome_id, vo.outcome_id,
         (select a.id from data_center.call_attempts a
           where a.sale_id = cr.sale_id
           order by a.attempted_at desc, a.attempt_no desc limit 1) as attempt_id
    from data_center.call_records cr
    join verdict_outcome vo on vo.verdict = cr.verification_outcome
   where coalesce(cr.attempt_count, 0) > 0
     and not exists (select 1 from data_center.call_attempts a where a.sale_id = cr.sale_id and a.outcome_id is not null)
),
kept as (
  insert into data_center.call_history_repair_20260911 (attempt_id, sale_id, inserted, old_outcome_id, old_call_outcome_id)
  select c.attempt_id, c.sale_id, false, null, c.call_outcome_id from candidates c
  returning sale_id
),
fixed_attempt as (
  update data_center.call_attempts a
     set outcome_id = c.outcome_id
    from candidates c
   where a.id = c.attempt_id
  returning a.sale_id
)
update data_center.call_records cr
   set call_outcome_id = c.outcome_id
  from candidates c
 where cr.sale_id = c.sale_id
   and cr.call_outcome_id is null;

-- 6. Readback ------------------------------------------------------------------
select (select count(*) from data_center.call_agent_links where user_id is not null) as linked,
       (select count(*) from data_center.call_agent_links where user_id is null) as unlinked,
       (select count(*) from data_center.call_history_repair_20260911 where inserted) as attempts_added,
       (select count(*) from data_center.call_history_repair_20260911 where not inserted) as outcomes_set,
       (select count(*) from data_center.v_call_attempts_resolved where source = 'sheet' and agent_user_id is null) as sheet_calls_for_nobody,
       (select count(*) from data_center.call_attempts where source is null) as unsourced;

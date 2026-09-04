-- ===========================================================================
-- Corrections as episodes, with a lifecycle and a route
-- ===========================================================================
--
-- A send-back used to be six columns on the call record: requested at and by,
-- a reason, a note, resolved at and by. That could say "something is wrong"
-- and "somebody said it is fixed", and nothing in between: not which field,
-- not who has it, not what changed, not whether the call centre agreed. The
-- rep's whole surface was a button called "Mark it fixed".
--
-- One row per episode now. open (waiting on Sales) -> fixed (awaiting the
-- call centre's review) -> resolved. Reopening starts the next episode rather
-- than rewriting this one, so the rows are the timeline and there is no
-- events table to keep in step.
--
-- The six old columns stay, kept equal to the newest episode by a trigger, so
-- every reader of them (the queue filter, the "Waiting on Sales" preset, the
-- corrections metric, the banner) keeps working unchanged until each is moved
-- across. `resolved_at` is stamped only when an episode resolves, so a record
-- Sales has fixed but nobody has reviewed still reads as open to them: that is
-- the right word for it from the call centre's side.
--
-- Rollback:
--   drop view if exists data_center.v_corrections;
--   create or replace view data_center.v_send_backs / v_call_center from
--     20260822030000 and 20260820010000;
--   drop trigger if exists corrections_mirror on data_center.corrections;
--   drop function if exists data_center.sync_correction_mirror();
--   drop function if exists data_center.sale_snapshot(uuid);
--   drop table if exists data_center.corrections;
--   alter table data_center.sales_rep_accounts drop column delegate_user_id;
--   delete from data_center.workflow_config where key = 'corrections.reason_fields';
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The episode
-- ---------------------------------------------------------------------------

create table if not exists data_center.corrections (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales (id) on delete cascade,
  -- 1, 2, 3 per sale. A reopen is the next number, never an edit of the last.
  seq           integer not null default 1,
  state         text not null check (state in ('open', 'fixed', 'resolved')),

  -- Why, and which fields. The reason is an option (data); the fields are keys
  -- from the corrections catalogue, prefilled from the reason map in
  -- workflow_config and edited by the agent.
  reason_id       uuid references data_center.option_values (id),
  disputed_fields text[] not null default '{}',
  note            text,

  opened_at  timestamptz not null default now(),
  opened_by  uuid references public.profiles (id) on delete set null,

  -- The route, stamped at open. The rep's name as the ERP wrote it and the
  -- account it resolved to at that moment; the live mapping is consulted too
  -- when a rep is linked later, so stamping loses nothing and keeps history.
  routed_rep_key     text,
  routed_rep_user_id uuid references public.profiles (id) on delete set null,
  assigned_to        uuid references public.profiles (id) on delete set null,
  claimed_at         timestamptz,

  -- The sale as it stood when the episode opened, and after Sales saved.
  before jsonb,
  after  jsonb,

  fixed_at        timestamptz,
  fixed_by        uuid references public.profiles (id) on delete set null,
  fix_note        text,
  -- When a standing recipient fixes it for a rep who has no account.
  fixed_on_behalf text,

  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  review_note    text,
  review_outcome text check (review_outcome in ('recall', 'no_recall', 'withdrawn', 'reopened')),
  -- attempt_count at close, so a recall earns a fresh allowance (slice 3).
  attempts_at_close integer,

  reopened_from uuid references data_center.corrections (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  unique (sale_id, seq)
);

comment on table data_center.corrections is
  'One row per send-back episode: open (waiting on Sales), fixed (awaiting review), resolved. Reopening adds the next seq. The six correction columns on call_records mirror the newest episode.';

create index if not exists corrections_active_idx
  on data_center.corrections (sale_id) where state in ('open', 'fixed');
create index if not exists corrections_state_opened_idx
  on data_center.corrections (state, opened_at desc);
create index if not exists corrections_routed_idx
  on data_center.corrections (routed_rep_user_id) where state in ('open', 'fixed');
create index if not exists corrections_fixed_by_idx
  on data_center.corrections (fixed_by) where state = 'fixed';

alter table data_center.corrections enable row level security;
revoke all on data_center.corrections from anon, authenticated;

drop trigger if exists audit_corrections on data_center.corrections;
create trigger audit_corrections
  after insert or delete or update on data_center.corrections
  for each row execute function data_center.log_change('id');


-- ---------------------------------------------------------------------------
-- 2. A delegate for a rep with no account
-- ---------------------------------------------------------------------------
--
-- Seventeen of the twenty-four open send-backs on production belong to a rep
-- with no profile row. The standing recipients carry those; a delegate lets
-- an administrator name who, per rep, so the list can say "routed to X for Y"
-- rather than "reaching nobody in particular".

alter table data_center.sales_rep_accounts
  add column if not exists delegate_user_id uuid references public.profiles (id) on delete set null;

comment on column data_center.sales_rep_accounts.delegate_user_id is
  'Who answers send-backs for a rep who has no account of their own. Null means the standing recipients alone.';


-- ---------------------------------------------------------------------------
-- 3. Which fields a reason points at: configuration
-- ---------------------------------------------------------------------------

insert into data_center.workflow_config (key, value, description)
values (
  'corrections.reason_fields',
  '{
     "wrong_phone":      ["phone", "other_phone"],
     "wrong_name":       ["end_user_name", "aka"],
     "wrong_address":    ["full_address", "state_backup", "lga_backup"],
     "wrong_serial":     ["stove_serial_no"],
     "missing_evidence": ["agreement_image_id", "signature"],
     "duplicate":        [],
     "other":            []
   }'::jsonb,
  'Which fields of the sale each send-back reason points at. Keys are correction_reason option values; values are keys from the corrections field catalogue. The agent may tick more.'
)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 4. The sale as one document
-- ---------------------------------------------------------------------------
--
-- Read at open (before) and at fix (after), from the same function, so a diff
-- compares like with like. Booleans for the three pieces of evidence rather
-- than the values: a signature is a long data URI nobody wants in a diff.

create or replace function data_center.sale_snapshot(p_sale_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'end_user_name',         s.end_user_name,
    'aka',                   s.aka,
    'phone',                 s.phone,
    'other_phone',           s.other_phone,
    'contact_person',        s.contact_person,
    'contact_phone',         s.contact_phone,
    'full_address',          a.full_address,
    'state_backup',          s.state_backup,
    'lga_backup',            s.lga_backup,
    'stove_serial_no',       s.stove_serial_no,
    'sales_date',            s.sales_date,
    'pot_quantity',          s.pot_quantity,
    'heat_retention_device', s.heat_retention_device,
    'previous_stove_type',   s.previous_stove_type,
    'previous_stove_other',  s.previous_stove_other,
    'meals_per_day',         s.meals_per_day,
    'cooking_fuel_source',   s.cooking_fuel_source,
    'cooking_location',      s.cooking_location,
    'amount',                s.amount,
    'total_paid',            s.total_paid,
    'signature',             nullif(trim(coalesce(s.signature, '')), '') is not null,
    'agreement_image_id',    s.agreement_image_id is not null,
    'stove_image_id',        s.stove_image_id is not null
  )
  from public.sales s
  left join public.addresses a on a.id = s.address_id
  where s.id = p_sale_id;
$$;

revoke all on function data_center.sale_snapshot(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. The mirror
-- ---------------------------------------------------------------------------

create or replace function data_center.sync_correction_mirror()
returns trigger
language plpgsql
as $$
declare
  c data_center.corrections%rowtype;
begin
  select * into c
    from data_center.corrections
   where sale_id = new.sale_id
   order by seq desc
   limit 1;

  insert into data_center.call_records (sale_id, created_by)
  values (new.sale_id, c.opened_by)
  on conflict (sale_id) do nothing;

  update data_center.call_records cr
     set correction_requested_at = c.opened_at,
         correction_requested_by = c.opened_by,
         correction_reason_id    = c.reason_id,
         correction_note         = c.note,
         correction_resolved_at  = case when c.state = 'resolved' then c.reviewed_at end,
         correction_resolved_by  = case when c.state = 'resolved' then c.reviewed_by end
   where cr.sale_id = new.sale_id
     and (cr.correction_requested_at is distinct from c.opened_at
       or cr.correction_requested_by is distinct from c.opened_by
       or cr.correction_reason_id    is distinct from c.reason_id
       or cr.correction_note         is distinct from c.note
       or cr.correction_resolved_at  is distinct from (case when c.state = 'resolved' then c.reviewed_at end)
       or cr.correction_resolved_by  is distinct from (case when c.state = 'resolved' then c.reviewed_by end));
  return new;
end;
$$;

drop trigger if exists corrections_mirror on data_center.corrections;
create trigger corrections_mirror
  after insert or update on data_center.corrections
  for each row execute function data_center.sync_correction_mirror();


-- ---------------------------------------------------------------------------
-- 6. The episodes that already exist
-- ---------------------------------------------------------------------------
--
-- One episode per call record that carries a request. Open ones stay open;
-- resolved ones close as `no_recall`, because whatever happened to them
-- happened before there was a review to record. `before` is today's sale:
-- the values at the time of the request were not kept anywhere.

with cfg as (
  select value from data_center.workflow_config where key = 'corrections.reason_fields'
),
src as (
  select cr.sale_id, cr.correction_requested_at, cr.correction_requested_by,
         cr.correction_reason_id, cr.correction_note,
         cr.correction_resolved_at, cr.correction_resolved_by,
         ov.value as reason_value,
         s.stove_serial_no
    from data_center.call_records cr
    join public.sales s on s.id = cr.sale_id
    left join data_center.option_values ov on ov.id = cr.correction_reason_id
   where cr.correction_requested_at is not null
     and not exists (select 1 from data_center.corrections c where c.sale_id = cr.sale_id)
)
insert into data_center.corrections
  (sale_id, seq, state, reason_id, disputed_fields, note, opened_at, opened_by,
   routed_rep_key, routed_rep_user_id, before,
   reviewed_at, reviewed_by, review_outcome, created_at, updated_at)
select
  src.sale_id,
  1,
  case when src.correction_resolved_at is null then 'open' else 'resolved' end,
  src.correction_reason_id,
  coalesce(
    array(select jsonb_array_elements_text(cfg.value -> src.reason_value)),
    '{}'::text[]
  ),
  src.correction_note,
  src.correction_requested_at,
  src.correction_requested_by,
  lower(trim(f.sales_rep)),
  coalesce(ra.user_id, ra.delegate_user_id),
  data_center.sale_snapshot(src.sale_id),
  src.correction_resolved_at,
  src.correction_resolved_by,
  case when src.correction_resolved_at is null then null else 'no_recall' end,
  src.correction_requested_at,
  coalesce(src.correction_resolved_at, src.correction_requested_at)
from src
cross join cfg
left join data_center.v_transfer_stoves b on b.stove_id = upper(trim(src.stove_serial_no))
left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep));


-- ---------------------------------------------------------------------------
-- 7. The views, told from the episodes
-- ---------------------------------------------------------------------------

-- Table 2, with correction_state read from the newest episode. Same columns,
-- same order, same types as before: only the one expression changes, and it
-- falls back to the six columns for a record that carries a request but no
-- episode (a test that set the columns by hand, or a write that predates the
-- backfill).
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
  (cr.sale_id is not null) as has_call_record
from data_center.v_sold_stoves v
left join data_center.call_records cr  on cr.sale_id = v.sale_id
left join data_center.option_values co on co.id      = cr.call_outcome_id
left join data_center.option_values ca on ca.id      = cr.call_agent_id
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
  'Table 2. Table 1 plus what the call centre added. correction_state is none, open, fixed or resolved, read from the newest correction episode.';


-- What is waiting on Sales: the open episodes, plus any record that carries a
-- request on the call record and no episode at all. Same columns as before,
-- so the banner and the send_backs action keep working; the rep's account
-- falls through to the delegate.
create or replace view data_center.v_send_backs as
with waiting as (
  select c.sale_id, c.opened_at as requested_at, c.note, c.reason_id, c.opened_by
    from data_center.corrections c
   where c.state = 'open'
  union all
  select cr.sale_id, cr.correction_requested_at, cr.correction_note,
         cr.correction_reason_id, cr.correction_requested_by
    from data_center.call_records cr
   where cr.correction_requested_at is not null
     and cr.correction_resolved_at is null
     and not exists (select 1 from data_center.corrections c where c.sale_id = cr.sale_id)
)
select
  w.sale_id,
  s.stove_serial_no,
  s.transaction_id,
  w.requested_at               as correction_requested_at,
  w.note                       as correction_note,
  ov.label                     as correction_reason,
  w.opened_by                  as correction_requested_by,
  rq.full_name                 as requested_by_name,
  f.organization_id,
  f.partner_name,
  f.transaction_id             as transfer_reference,
  f.sales_rep,
  coalesce(ra.user_id, ra.delegate_user_id) as sales_rep_user_id,
  ra.no_account                as sales_rep_marked_no_account,
  rp.full_name                 as sales_rep_account_name,
  coalesce(cr.corrected_end_user_name, s.end_user_name) as end_user_name,
  coalesce(cr.corrected_phone, s.phone)                 as phone,
  s.sales_date
from waiting w
join public.sales s on s.id = w.sale_id
left join data_center.call_records cr on cr.sale_id = w.sale_id
left join data_center.option_values ov on ov.id = w.reason_id
left join public.profiles rq on rq.id = w.opened_by
left join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep))
left join public.profiles rp on rp.id = coalesce(ra.user_id, ra.delegate_user_id)
where s.is_archived is not true;

comment on view data_center.v_send_backs is
  'Open send-backs, routed live through the rep mapping and its delegate. Kept for the banner and the send_backs action; v_corrections carries every episode.';


-- Every episode with everything the list, the workspace and the review need.
create or replace view data_center.v_corrections as
select
  c.id,
  c.sale_id,
  c.seq,
  c.state,
  c.reason_id,
  ov.value                     as reason_value,
  ov.label                     as reason_label,
  c.disputed_fields,
  c.note,
  c.opened_at,
  c.opened_by,
  op.full_name                 as opened_by_name,
  c.routed_rep_key,
  c.routed_rep_user_id,
  f.sales_rep,
  -- The account that answers today: the stamp, else the live mapping, else
  -- the delegate. Linking a rep after the fact routes what is already open.
  coalesce(c.routed_rep_user_id, ra.user_id, ra.delegate_user_id) as current_rep_user_id,
  rp.full_name                 as rep_account_name,
  ra.no_account                as rep_marked_no_account,
  (ra.user_id is null and ra.delegate_user_id is not null) as via_delegate,
  c.assigned_to,
  asg.full_name                as assigned_to_name,
  c.claimed_at,
  c.before,
  c.after,
  c.fixed_at,
  c.fixed_by,
  fx.full_name                 as fixed_by_name,
  c.fix_note,
  c.fixed_on_behalf,
  c.reviewed_at,
  c.reviewed_by,
  rv.full_name                 as reviewed_by_name,
  c.review_note,
  c.review_outcome,
  c.attempts_at_close,
  c.reopened_from,
  s.stove_serial_no,
  s.transaction_id,
  f.organization_id,
  f.partner_name,
  f.transaction_id             as transfer_reference,
  coalesce(cr.corrected_end_user_name, s.end_user_name) as end_user_name,
  coalesce(cr.corrected_phone, s.phone)                 as phone,
  s.sales_date,
  cr.verification_outcome,
  coalesce(cr.attempt_count, 0) as attempt_count,
  cr.serial_unconfirmed_at,
  s.is_archived
from data_center.corrections c
join public.sales s on s.id = c.sale_id
left join data_center.call_records cr on cr.sale_id = c.sale_id
left join data_center.option_values ov on ov.id = c.reason_id
left join public.profiles op on op.id = c.opened_by
left join public.profiles asg on asg.id = c.assigned_to
left join public.profiles fx on fx.id = c.fixed_by
left join public.profiles rv on rv.id = c.reviewed_by
left join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep))
left join public.profiles rp on rp.id = coalesce(c.routed_rep_user_id, ra.user_id, ra.delegate_user_id);

comment on view data_center.v_corrections is
  'Every correction episode with its route, its people and the sale it belongs to. The list, the workspace and the review read this.';


-- ---------------------------------------------------------------------------
-- 8. The people the flow routes to can reach the page
-- ---------------------------------------------------------------------------
--
-- Every linked rep and both standing recipients on production hold no
-- module_access row, so the corrections page refused all of them. Linking and
-- recipient-setting provision the sales_rep level from now on; this gives it
-- to the ones already linked. Nobody who already holds a level is touched.

insert into data_center.module_access (user_id, access_role)
select distinct x.user_id, 'sales_rep'
  from (
    select user_id from data_center.sales_rep_accounts where user_id is not null
    union
    select delegate_user_id from data_center.sales_rep_accounts where delegate_user_id is not null
    union
    select user_id from data_center.send_back_recipients where is_enabled
  ) x
 where not exists (select 1 from data_center.module_access m where m.user_id = x.user_id)
on conflict (user_id) do nothing;

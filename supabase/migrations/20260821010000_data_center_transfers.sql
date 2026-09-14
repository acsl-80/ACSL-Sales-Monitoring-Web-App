-- Phase 8: what was sold to a partner, and how much of it has come back.
--
-- THE FINDING THAT MADE THIS SMALL
--
-- The brief asked for transfer records to be synced into the Data Centre, with
-- a scheduled pull as the default assumption. No pull is needed: the records
-- are already in this database. `public.stove_transfer_history` is written by
-- the ERP sync functions and holds, in production today:
--
--   497 transfers, 14,564 stoves, 278 partners, 23 sales reps
--   488 of the 497 carry the sales representative's name
--
-- against 38 sales recorded in the whole app. That gap is the point of the
-- funnel below, and it is why "sold" and "recovered" have to be counted from
-- different places.
--
-- So this is a view. Copying it into data_center would be a second version of
-- the truth, maintained by us, for no gain.
--
-- THE MATCHING KEY, WHICH ALSO ALREADY EXISTED
--
--   sales.stove_serial_no
--     -> stove_ids_base.stove_id          unique on (stove_id, organization_id)
--     -> stove_ids_base.sales_reference   kept current by two triggers
--     -> stove_transfer_history.transaction_id
--
-- A string join rather than a foreign key, which is not how anyone would build
-- it today, but it is maintained and it is correct. Inventing a second key
-- would mean two answers to "which transfer did this sale come from".

-- ===========================================================================
-- 0. The fifth verification outcome
--
-- The funnel below counts `unreachable` as its own bucket, so the value has to
-- exist before the view reads it. It is a conclusion an agent reaches, not
-- something derived from a call outcome: "we tried and there is nobody at the
-- end of this number" is a different answer from "we have not concluded".
--
-- Existing rows are untouched. Nothing becomes `unreachable` unless an agent
-- says so.
-- ===========================================================================

alter table data_center.call_records
  drop constraint if exists call_records_verification_outcome_check;

alter table data_center.call_records
  add constraint call_records_verification_outcome_check
  check (verification_outcome in (
    'fully_verified',
    'partially_verified',
    'doubtful_verification',
    'unreachable',
    'not_verified'
  ));

update data_center.workflow_config
set value = '["fully_verified","partially_verified","doubtful_verification","unreachable","not_verified"]'::jsonb
where key = 'verification_states';


-- ===========================================================================
-- 1. The transfers themselves
-- ===========================================================================

create or replace view data_center.v_transfers as
select
  t.id                        as transfer_id,
  t.transaction_id,
  t.organization_id,
  coalesce(o.partner_name, t.partner_name) as partner_name,
  t.partner_id,
  t.state                     as transfer_state,
  t.branch                    as transfer_branch,
  t.stove_count               as issued_count,
  t.sales_rep,
  t.sales_factory,
  t.customer,
  t.sales_date::text          as sales_date,
  t.transfer_date,
  t.source
from public.stove_transfer_history t
left join public.organizations o on o.id = t.organization_id;

comment on view data_center.v_transfers is
  'What was transferred to each partner. Read from public, never copied: the ERP sync already maintains it.';


-- One row per serial in a transfer.
--
-- `stove_ids` is a jsonb array of objects carrying stove_id, factory and
-- sales_reference. Expanding it is what lets a sale be traced back to the
-- transfer it came from, and it is the only place that expansion happens.
create or replace view data_center.v_transfer_stoves as
select
  t.id            as transfer_id,
  t.transaction_id,
  t.organization_id,
  upper(trim(e.value ->> 'stove_id')) as stove_id
from public.stove_transfer_history t
cross join lateral jsonb_array_elements(t.stove_ids) e
where e.value ->> 'stove_id' is not null;

comment on view data_center.v_transfer_stoves is
  'A transfer expanded to one row per serial. The spine that ties a sale back to its transfer.';


-- ===========================================================================
-- 2. Received: paper that has physically come back
--
-- WHY THIS IS A COUNT AND NOT A ROW PER RECORD
--
-- Paper arrives in bundles, not individually. Someone can say "Partner X
-- returned 50 forms on Tuesday" the moment the envelope lands, which is weeks
-- before anyone types them. Logging each form on arrival would mean handling
-- every sheet twice, and the second handling is the one that gets skipped.
--
-- This is also deliberately transitional. As stations start entering their own
-- sales directly, there is no paper and no receipt step: a record is received
-- the moment it is digitalised. The funnel below handles both, so nothing has
-- to change when the paper stops.
-- ===========================================================================

create table data_center.record_consignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,

  -- Optional. A consignment usually covers one transfer, but a partner can
  -- return a mixed envelope, and forcing a transfer would mean guessing.
  transaction_id  text,

  received_count  integer not null check (received_count >= 0),
  received_at     date not null default current_date,
  note            text,

  source text not null default 'paper' check (source in ('paper', 'digital')),

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table data_center.record_consignments is
  'Paper records physically returned by a partner. A count per consignment, because paper arrives in bundles and logging each sheet on arrival is a handling nobody does twice.';

create index record_consignments_org_idx
  on data_center.record_consignments (organization_id, received_at desc);
create index record_consignments_txn_idx
  on data_center.record_consignments (transaction_id) where transaction_id is not null;

create trigger record_consignments_log
  after insert or update or delete on data_center.record_consignments
  for each row execute function data_center.log_change('id');

alter table data_center.record_consignments enable row level security;


-- ===========================================================================
-- 3. The funnel
--
-- TWO SHAPES, BECAUSE THERE ARE TWO JOBS
--
-- This view aggregates over public.sales, and the module's own rule is that a
-- read never does that. So it is not what a page queries. It is the definition
-- the compute run reads once, writing the answers into `transfer_funnel`
-- below, which is what pages actually read.
--
-- The route to that conclusion is worth keeping, because the obvious fixes all
-- failed and someone will try them again. Measured at 500,000 sales, asking for
-- a single transfer:
--
--   grouped CTE                       552 ms   aggregates every transfer, then filters
--   lateral                           921 ms   flattened straight back to the CTE
--   lateral with an offset 0 fence   1484 ms   fence held, planner still hashed all of sales
--   seqscan disabled                 2008 ms   nested loop, and worse again
--
-- The planner will not do forty index lookups against sales when it can hash
-- the table instead, and no rewrite persuaded it otherwise. Grouped is the
-- right shape for the job that actually matters: one pass over sales covering
-- every transfer at once, which is what a refresh wants. A full refresh costs
-- about what a single-transfer query did, which says the per-transfer version
-- was never going to be the cheap one.
-- ===========================================================================

create or replace view data_center.v_transfer_funnel as
with digitalised as (
  select
    ts.transfer_id,
    count(*)                                                           as digitalised_count,
    count(*) filter (where cr.verification_outcome = 'fully_verified') as verified_count,
    count(*) filter (where cr.verification_outcome in
      ('partially_verified', 'doubtful_verification'))                 as unverified_count,
    count(*) filter (where cr.verification_outcome = 'unreachable')    as unreachable_count,
    count(*) filter (where cr.sale_id is null
                        or cr.verification_outcome = 'not_verified')   as unresolved_count
  from data_center.v_transfer_stoves ts
  join public.sales s
    on upper(trim(s.stove_serial_no)) = ts.stove_id
   and s.is_archived is not true
  left join data_center.call_records cr on cr.sale_id = s.id
  group by ts.transfer_id
),
consigned as (
  select t.id as transfer_id, sum(rc.received_count) as received_logged
  from public.stove_transfer_history t
  join data_center.record_consignments rc on rc.transaction_id = t.transaction_id
  group by t.id
)
select
  v.transfer_id,
  v.transaction_id,
  v.organization_id,
  v.partner_name,
  v.partner_id,
  v.transfer_state,
  v.transfer_branch,
  v.sales_rep,
  v.sales_date,
  v.transfer_date,
  v.issued_count,
  -- Received: the paper that was logged, or what has been digitalised where
  -- none was, because a record entered directly has no paper stage.
  coalesce(c.received_logged, d.digitalised_count, 0)::integer as received_count,
  (c.received_logged is not null)                              as received_is_logged,
  coalesce(d.digitalised_count, 0)::integer                    as digitalised_count,
  coalesce(d.verified_count, 0)::integer                       as verified_count,
  coalesce(d.unverified_count, 0)::integer                     as unverified_count,
  coalesce(d.unreachable_count, 0)::integer                    as unreachable_count,
  coalesce(d.unresolved_count, 0)::integer                     as unresolved_count,
  -- What is still out there. The number the brief asks to see at a glance.
  (v.issued_count - coalesce(d.digitalised_count, 0))::integer as outstanding_count
from data_center.v_transfers v
left join digitalised d on d.transfer_id = v.transfer_id
left join consigned   c on c.transfer_id = v.transfer_id;

comment on view data_center.v_transfer_funnel is
  'The funnel definition. Read once per refresh, never by a page: it aggregates over public.sales, which this module reserves for compute.';


-- What pages read.
--
-- The same columns, already computed, plus when. Opening Partner Records
-- becomes an indexed scan over a few hundred rows instead of a pass over half
-- a million sales.
create table data_center.transfer_funnel (
  transfer_id        uuid primary key,
  transaction_id     text not null,
  organization_id    uuid,
  partner_name       text,
  partner_id         text,
  transfer_state     text,
  transfer_branch    text,
  sales_rep          text,
  sales_date         text,
  transfer_date      timestamptz,
  issued_count       integer not null default 0,
  received_count     integer not null default 0,
  received_is_logged boolean not null default false,
  digitalised_count  integer not null default 0,
  verified_count     integer not null default 0,
  unverified_count   integer not null default 0,
  unreachable_count  integer not null default 0,
  unresolved_count   integer not null default 0,
  outstanding_count  integer not null default 0,
  computed_at        timestamptz not null default now()
);

comment on table data_center.transfer_funnel is
  'The funnel, precomputed. Refreshed by refresh_transfer_funnel(). Pages read this and never the view.';

create index transfer_funnel_org_idx   on data_center.transfer_funnel (organization_id, sales_date desc);
create index transfer_funnel_state_idx on data_center.transfer_funnel (transfer_state);
create index transfer_funnel_rep_idx   on data_center.transfer_funnel (sales_rep);

-- The queue that matters: transfers with stoves still unaccounted for.
create index transfer_funnel_outstanding_idx
  on data_center.transfer_funnel (outstanding_count desc) where outstanding_count > 0;


-- Refreshed whole rather than incrementally.
--
-- A transfer's counts move whenever any of its sales moves, and working out
-- which transfers those were costs more than recomputing all of them. The
-- upsert means a page never sees a half-built table, which a delete-then-insert
-- would not give.
create or replace function data_center.refresh_transfer_funnel()
returns integer
language plpgsql security definer set search_path = data_center, public as $fn$
declare
  n integer;
begin
  insert into data_center.transfer_funnel
    (transfer_id, transaction_id, organization_id, partner_name, partner_id,
     transfer_state, transfer_branch, sales_rep, sales_date, transfer_date,
     issued_count, received_count, received_is_logged, digitalised_count,
     verified_count, unverified_count, unreachable_count, unresolved_count,
     outstanding_count, computed_at)
  select
    f.transfer_id, f.transaction_id, f.organization_id, f.partner_name, f.partner_id,
    f.transfer_state, f.transfer_branch, f.sales_rep, f.sales_date, f.transfer_date,
    f.issued_count, f.received_count, f.received_is_logged, f.digitalised_count,
    f.verified_count, f.unverified_count, f.unreachable_count, f.unresolved_count,
    f.outstanding_count, now()
  from data_center.v_transfer_funnel f
  on conflict (transfer_id) do update set
    transaction_id     = excluded.transaction_id,
    organization_id    = excluded.organization_id,
    partner_name       = excluded.partner_name,
    partner_id         = excluded.partner_id,
    transfer_state     = excluded.transfer_state,
    transfer_branch    = excluded.transfer_branch,
    sales_rep          = excluded.sales_rep,
    sales_date         = excluded.sales_date,
    transfer_date      = excluded.transfer_date,
    issued_count       = excluded.issued_count,
    received_count     = excluded.received_count,
    received_is_logged = excluded.received_is_logged,
    digitalised_count  = excluded.digitalised_count,
    verified_count     = excluded.verified_count,
    unverified_count   = excluded.unverified_count,
    unreachable_count  = excluded.unreachable_count,
    unresolved_count   = excluded.unresolved_count,
    outstanding_count  = excluded.outstanding_count,
    computed_at        = excluded.computed_at;

  get diagnostics n = row_count;

  -- A transfer that has been cancelled disappears from the view, so its row
  -- here is stale rather than merely old. Removed on the same pass.
  delete from data_center.transfer_funnel t
  where not exists (
    select 1 from public.stove_transfer_history h where h.id = t.transfer_id
  );

  return n;
end;
$fn$;

alter table data_center.transfer_funnel enable row level security;


-- THE RECONCILIATION IDENTITY, STATED SO IT IS NOT MISREAD
--
--   verified + unverified + unreachable + unresolved = digitalised_count
--
-- and NOT received_count. Every digitalised record sits in exactly one of the
-- four buckets, because the five outcomes are exhaustive and a record with no
-- call record counts as unresolved.
--
-- Where paper has been logged, received_count can exceed digitalised_count.
-- That difference is the transcription backlog: forms in the building that
-- nobody has typed yet. It is a number worth seeing, not an inconsistency.
--
-- The dashboard column the brief calls "Sales user data received" is
-- digitalised_count, because that is what "records that have come in against
-- those sales" means once they are in the system.


-- ===========================================================================
-- 4. Indexes the funnel needs
--
-- The join from a serial back to a sale is the hot path. public.sales already
-- carries no index on stove_serial_no, which is invisible at 38 rows and is
-- the difference between a funnel that loads and one that does not at 500,000.
-- Additive, and dropping it leaves the sales app exactly as it was.
-- ===========================================================================

create index if not exists idx_sales_stove_serial_upper
  on public.sales (upper(trim(stove_serial_no)))
  where is_archived is not true;

comment on index public.idx_sales_stove_serial_upper is
  'Ties a sale back to its transfer for the Data Center reconciliation funnel. Added by the data_center module; safe to drop if that module is removed.';

create index if not exists idx_transfer_history_org_date
  on public.stove_transfer_history (organization_id, sales_date desc);


-- ===========================================================================
-- 5. Configuration
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('reconciliation.received_falls_back_to_digitalised', 'true'::jsonb,
   'When no paper consignment has been logged for a transfer, treat everything digitalised as received. Set false once every partner logs consignments and a gap between the two becomes meaningful.')
on conflict (key) do nothing;


-- ===========================================================================
-- 6. Who refreshes this
--
-- `data-center-compute` calls refresh_transfer_funnel() straight after
-- compute_metrics(), on the same connection and inside the same advisory lock.
--
-- Wrapping it inside compute_metrics() would have been tidier to look at and
-- would have meant copying that function's whole body into this migration to
-- call the old one, which is how two definitions of the same computation start
-- disagreeing. One job, one lock, one "as of" timestamp, and the orchestration
-- stays in the function that already orchestrates.
-- ===========================================================================

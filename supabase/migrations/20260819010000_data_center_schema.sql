-- Data Center module: schema container, control plane, registry and spine.
--
-- Everything the module owns lives in its own `data_center` schema. Nothing in
-- `public` is altered by this migration: no ALTER TABLE, no new columns, no
-- triggers on existing tables. The rollback is one statement,
-- `drop schema data_center cascade`, which is what makes the module detachable.
--
-- DELIBERATELY NOT DONE HERE: `data_center` is never added to `[api].schemas`
-- in supabase/config.toml. Keeping it out of PostgREST is the isolation
-- guarantee the whole design rests on, and it is also what structurally
-- prevents the sales-mobile Flutter app from ever reaching this data, since it
-- talks to Supabase through that same PostgREST API. Access is service role
-- only, through `data-center-*` edge functions.
--
-- See src/app/data-center/PLAN.md for the reasoning behind the shape.

create schema if not exists data_center;

-- Lock the schema down explicitly rather than relying on defaults. The module
-- is unreachable by design, and this is the second lock behind the PostgREST
-- omission above.
revoke all on schema data_center from public;
revoke all on schema data_center from anon, authenticated;
grant usage on schema data_center to service_role;


-- ===========================================================================
-- Control plane
-- ===========================================================================

-- Tier 2 of the permission model. Tier 1 (whether the module exists for a user
-- at all) stays in the host app's static route map in src/lib/permissions.ts.
-- Tier 2 is per-user and data-driven, because "different features for different
-- users" cannot be expressed by a compile-time role map without a redeploy per
-- user.
--
-- This table is advisory to the UI and authoritative in the edge function. A
-- gate that only hides a button is not a permission.
create table data_center.feature_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  feature_key text not null,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  unique (user_id, feature_key)
);

comment on table data_center.feature_grants is
  'Per-user feature grants inside the Data Center. Resolved server-side from the caller JWT on every request.';

create index feature_grants_user_idx
  on data_center.feature_grants (user_id, feature_key);


-- Runtime configuration. Thresholds, callback limits and the module's own
-- definition of a complete sale live here as data, never as TypeScript
-- constants, so changing them is an edit rather than a release.
create table data_center.workflow_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table data_center.workflow_config is
  'Runtime knobs read on every request. Never hard-code a value that belongs here.';


-- Precomputed dashboard values. This table is the reason dashboards stay fast
-- as the row count grows: reading one is an indexed lookup whether the
-- underlying data is 38 rows or 500,000. Aggregation happens in
-- `data-center-compute` on a schedule, never on page load.
create table data_center.metric_snapshots (
  id          uuid primary key default gen_random_uuid(),
  metric_key  text not null,
  dimension   jsonb not null default '{}'::jsonb,
  value_num   numeric,
  value_text  text,
  computed_at timestamptz not null default now()
);

comment on table data_center.metric_snapshots is
  'Precomputed dashboard values. If a dashboard query aggregates public.sales directly, it belongs in compute, not read.';

create index metric_snapshots_key_time_idx
  on data_center.metric_snapshots (metric_key, computed_at desc);


-- ===========================================================================
-- Registry
--
-- This replaces the Key tab of the call centre workbook, whose own instruction
-- is the requirement: "Edit a list there and the dropdown updates
-- automatically." Question wording, option lists and field ordering are data.
-- Adding, renaming or retiring a question is data entry, not a deploy.
-- ===========================================================================

create table data_center.option_lists (
  key         text primary key,
  label       text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table data_center.option_values (
  id         uuid primary key default gen_random_uuid(),
  list_key   text not null references data_center.option_lists (key) on delete cascade,
  value      text not null,
  label      text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  unique (list_key, value)
);

comment on table data_center.option_values is
  'The choices behind every dropdown. Records reference these by id, so renaming a label never rewrites history.';

create index option_values_list_idx
  on data_center.option_values (list_key, sort_order) where is_active;


-- Field definitions drive rendering and validation of the questionnaire.
--
-- `storage` implements the promotion path: a question starts life in
-- call_records.answers (jsonb, no migration needed to add or retire it) and
-- graduates to a real indexed column once it starts being aggregated, at which
-- point `column_name` records where it went. Pure jsonb was rejected because
-- aggregating 500k jsonb rows is the slow path this design exists to avoid;
-- pure columns were rejected because every wording change would be a migration.
create table data_center.field_defs (
  key             text primary key,
  label           text not null,
  section         text not null,
  input_type      text not null
                  check (input_type in ('text','number','date','select','boolean','computed')),
  option_list_key text references data_center.option_lists (key) on delete restrict,
  storage         text not null default 'answers'
                  check (storage in ('answers','column')),
  column_name     text,
  sort_order      integer not null default 0,
  is_required     boolean not null default false,
  is_active       boolean not null default true,
  help_text       text,
  created_at      timestamptz not null default now(),

  -- A select must name its list; a column-backed field must name its column.
  constraint field_defs_select_needs_list
    check (input_type <> 'select' or option_list_key is not null),
  constraint field_defs_column_needs_name
    check (storage <> 'column' or column_name is not null)
);

create index field_defs_active_idx
  on data_center.field_defs (section, sort_order) where is_active;


-- ===========================================================================
-- Spine: the call centre layer (Table 2)
--
-- Holds only what the call centre adds. Sale facts stay in public.sales and are
-- read through the views below, never copied here.
-- ===========================================================================

create table data_center.call_records (
  sale_id uuid primary key references public.sales (id) on delete cascade,

  -- Four states, taken from how the workbook is actually used, not from an
  -- assumption. Its SUMMARY tab counts Fully Verified, Doubtful Verified,
  -- Partially Verified and Not Verified, and `Doubtful` carried 24 of 139
  -- judgements in a single week, so collapsing it would lose real signal.
  --
  -- This one IS a CHECK rather than a registry list, deliberately: it is
  -- load-bearing for every dashboard, so changing it should require a
  -- migration and a conversation, not a row edit.
  verification_outcome text not null default 'not_verified'
    check (verification_outcome in
      ('fully_verified','partially_verified','doubtful_verification','not_verified')),

  -- What happened on the phone, which is a different fact from the conclusion
  -- drawn above. The workbook keeps them in separate columns (R and AP) and
  -- collapsing them would destroy the difference between "could not reach" and
  -- "reached and could not confirm".
  --
  -- Registry-backed rather than a CHECK, because this list is expected to move:
  -- the workbook already contains RESPONDED, REPONDED and NO PHONE NUMBER, none
  -- of which appear in its own Key tab.
  call_outcome_id uuid references data_center.option_values (id) on delete restrict,
  call_agent_id   uuid references data_center.option_values (id) on delete restrict,

  -- Three attempts, matching the workbook's Call_date_1/2/3.
  call_date_1 date,
  call_date_2 date,
  call_date_3 date,

  -- The numbers the call centre actually reached, kept alongside the ones the
  -- sale was recorded with rather than overwriting them. The divergence between
  -- the two IS the correction loop, and it is only queryable if both survive.
  corrected_phone     text,
  corrected_alt_phone text,

  -- Enrichment the sales schema has nowhere to put today.
  ward     text,
  landmark text,

  -- The serial as stated by the customer, against sales.stove_serial_no. The
  -- workbook computes the match with a spreadsheet formula; here it is derived
  -- in the view, so it cannot drift out of sync with its inputs.
  stated_serial text,

  -- Registry-driven questionnaire answers.
  answers        jsonb not null default '{}'::jsonb,
  other_comments text,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table data_center.call_records is
  'Call centre state about a sale. Adds facts, never copies them: public.sales remains the only place a sale lives.';

create index call_records_outcome_idx on data_center.call_records (verification_outcome);
create index call_records_call_outcome_idx on data_center.call_records (call_outcome_id);
create index call_records_agent_idx on data_center.call_records (call_agent_id);
create index call_records_answers_idx on data_center.call_records using gin (answers);


-- ===========================================================================
-- Import staging
--
-- Bulk import commits through the existing `create-sale` edge function rather
-- than inserting into public.sales directly, so stove linking, status and
-- validation stay in one place. These tables hold the staging and the audit
-- trail either side of that call.
-- ===========================================================================

create table data_center.import_batches (
  id       uuid primary key default gen_random_uuid(),
  source   text not null check (source in ('receipt','call_center')),
  filename text,

  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),

  -- `dry_run` is a first-class state, not a flag. Committing a receipt backlog
  -- moves stoves from available to sold and visibly changes the sales app's own
  -- inventory figures, so seeing what would happen has to be possible before it
  -- happens.
  state text not null default 'staged'
    check (state in ('staged','validated','dry_run','committed','rolled_back','failed')),

  total_rows     integer not null default 0,
  valid_rows     integer not null default 0,
  rejected_rows  integer not null default 0,
  committed_rows integer not null default 0,

  committed_at timestamptz,
  committed_by uuid references public.profiles (id) on delete set null,
  notes        text
);

create index import_batches_state_idx on data_center.import_batches (state, uploaded_at desc);


create table data_center.import_rows (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references data_center.import_batches (id) on delete cascade,
  row_number integer not null,

  -- The raw payload is retained so a rejected row can be explained rather than
  -- merely refused. Roughly 8% of serials in a real workbook do not match
  -- stock, which makes rejection the normal path, not the error path.
  raw jsonb not null,

  status text not null default 'pending'
    check (status in ('pending','valid','rejected','committed','exception')),
  rejection_reason text,

  stove_serial_no text,
  sale_id         uuid references public.sales (id) on delete set null,

  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,

  unique (batch_id, row_number)
);

create index import_rows_batch_status_idx on data_center.import_rows (batch_id, status);
create index import_rows_serial_idx on data_center.import_rows (stove_serial_no);


-- ===========================================================================
-- Views
--
-- Table 1 is a view and owns no data. Columns are named explicitly rather than
-- SELECT *, so a column added to public.sales cannot silently widen this
-- module's surface.
-- ===========================================================================

create view data_center.v_sold_stoves as
select
  s.id                     as sale_id,
  s.transaction_id,
  s.sales_date,
  s.stove_serial_no,
  s.end_user_name,
  s.aka,
  s.phone                  as primary_phone,
  s.other_phone            as alternative_phone,
  s.contact_person         as buyer_name,
  s.contact_phone          as buyer_phone,
  s.partner_name,
  s.retailer_branch,
  s.state_backup           as user_state,
  s.lga_backup             as user_lga,
  s.amount,
  s.total_paid,
  s.payment_status,
  s.is_installment,
  s.status                 as sale_status,
  s.is_archived,
  s.platform,
  s.created_at,
  s.organization_id,
  s.created_by,
  a.full_address           as user_residential_address,
  a.latitude,
  a.longitude,
  o.state                  as partner_state,
  o.address                as partner_address,
  o.branch                 as partner_branch,
  o.partner_id,
  pm.name                  as sales_model,
  pr.full_name             as sale_agent_name,
  s.previous_stove_type,
  s.previous_stove_other,
  s.pot_quantity,
  s.heat_retention_device,
  b.factory,
  b.status                 as stove_stock_status
from public.sales s
left join public.addresses      a  on a.id  = s.address_id
left join public.organizations  o  on o.id  = s.organization_id
left join public.payment_models pm on pm.id = s.payment_model_id
left join public.profiles       pr on pr.id = s.created_by
left join public.stove_ids_base b  on b.stove_id = s.stove_serial_no;

comment on view data_center.v_sold_stoves is
  'Table 1. Sold stove records assembled from public. Owns no data.';


create view data_center.v_call_center as
select
  v.*,
  cr.verification_outcome,
  cr.call_date_1,
  cr.call_date_2,
  cr.call_date_3,
  cr.corrected_phone,
  cr.corrected_alt_phone,
  cr.ward,
  cr.landmark,
  cr.stated_serial,
  cr.answers,
  cr.other_comments,
  cr.updated_at as call_record_updated_at,
  co.label      as call_outcome,
  ca.label      as call_agent,

  -- Replaces the workbook's SN Matching formula column. Derived rather than
  -- stored, so it cannot drift away from the values it compares.
  case
    when cr.stated_serial is null or v.stove_serial_no is null then null
    else upper(trim(cr.stated_serial)) = upper(trim(v.stove_serial_no))
  end as serial_matches,

  -- The correction signal: the call centre reached a different number from the
  -- one the sale was recorded with.
  case
    when cr.corrected_phone is null or v.primary_phone is null then null
    else right(regexp_replace(cr.corrected_phone, '\D', '', 'g'), 10)
       <> right(regexp_replace(v.primary_phone,   '\D', '', 'g'), 10)
  end as phone_was_corrected,

  (cr.sale_id is not null) as has_call_record
from data_center.v_sold_stoves v
left join data_center.call_records cr on cr.sale_id          = v.sale_id
left join data_center.option_values co on co.id              = cr.call_outcome_id
left join data_center.option_values ca on ca.id              = cr.call_agent_id;

comment on view data_center.v_call_center is
  'Table 2. Table 1 joined to the call centre layer, so an operator sees one wide table.';


-- ===========================================================================
-- Row level security
--
-- Enabled with no policy granted to anon or authenticated. Combined with the
-- schema grants above and the PostgREST omission, the module is unreachable by
-- anything except a service-role edge function. This is defence in depth: any
-- one of the three would do, and all three are cheap.
-- ===========================================================================

alter table data_center.feature_grants   enable row level security;
alter table data_center.workflow_config  enable row level security;
alter table data_center.metric_snapshots enable row level security;
alter table data_center.option_lists     enable row level security;
alter table data_center.option_values    enable row level security;
alter table data_center.field_defs       enable row level security;
alter table data_center.call_records     enable row level security;
alter table data_center.import_batches   enable row level security;
alter table data_center.import_rows      enable row level security;

grant select, insert, update, delete on all tables in schema data_center to service_role;

alter default privileges in schema data_center
  grant select, insert, update, delete on tables to service_role;

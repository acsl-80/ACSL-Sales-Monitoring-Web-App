-- ===========================================================================
-- Sending a record back to Sales, to somebody who will see it
-- ===========================================================================
--
-- The call centre has been able to send a record back since the call layer was
-- built: `correction_requested_at` opens it, `correction_resolved_at` closes
-- it, and a reason says why. What has never existed is anybody being told. The
-- record sat in a state nobody was watching, and the loop closed only if
-- somebody happened to open the right filter.
--
-- Two tables here, and the second one is the whole difficulty.
--
-- ---------------------------------------------------------------------------
-- WHY THE SALES REP IS NOT ALREADY A PERSON
-- ---------------------------------------------------------------------------
--
-- "Send it back to the rep responsible for that consignment" sounds like a
-- foreign key. It is not. `stove_transfer_history.sales_rep` is free text
-- written by the ERP, and measured against production:
--
--     23 distinct rep names
--     11 match an app profile by name
--     12 do not - including the three largest by volume:
--        Femi Isaac (145 transfers), ELIZABETH TIMOTHY (68), Lucky Sunday (36)
--
-- and four of the values are not people at all: `ACSL Admin`, `Administrator`,
-- `Keffi` (a town) and `Gombe` (a state).
--
-- Matching on name alone would therefore route most of the volume to nobody,
-- silently. `sales_rep_accounts` makes the link explicit and, more
-- importantly, makes the gap visible: an unmapped rep is a row somebody can
-- see and fix, rather than a send-back that quietly reached no one.
--
-- ---------------------------------------------------------------------------
-- WHO ACTUALLY GETS IT
-- ---------------------------------------------------------------------------
--
-- The recipients chosen in Settings are the authority and always receive it.
-- The mapped rep receives it as well, when there is one. That order matters:
-- where a rep has no account the designated recipients still treat the record,
-- so no send-back is ever routed into a void.
--
-- Neither table stores an assignment per record. Routing is computed when the
-- queue is read, from the recipient list as it stands now and the mapping as
-- it stands now - so correcting a mapping fixes every send-back already open
-- rather than only the ones raised afterwards.
--
-- Rollback:
--   drop view if exists data_center.v_send_backs;
--   drop table if exists data_center.send_back_recipients;
--   drop table if exists data_center.sales_rep_accounts;
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Who treats send-backs
-- ---------------------------------------------------------------------------

create table if not exists data_center.send_back_recipients (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- Disabled rather than deleted, so somebody on leave stops receiving without
  -- anybody having to remember who was on the list before they left.
  is_enabled boolean not null default true,

  note     text,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles (id) on delete set null
);

comment on table data_center.send_back_recipients is
  'The people who treat records sent back from the call centre. Chosen in Settings, and always notified whether or not the sale''s rep has an account.';

create index if not exists send_back_recipients_enabled_idx
  on data_center.send_back_recipients (user_id) where is_enabled;


-- ---------------------------------------------------------------------------
-- 2. Which app user a rep name means
-- ---------------------------------------------------------------------------

create table if not exists data_center.sales_rep_accounts (
  -- The ERP's text, folded for comparison. `ELIZABETH TIMOTHY` and
  -- `Elizabeth Timothy` are one person typed twice, and a mapping keyed on the
  -- raw string would need linking twice and would come apart the moment
  -- somebody fixed the capitalisation upstream.
  rep_key text primary key,

  -- As the ERP most recently wrote it, for display.
  rep_name text not null,

  -- Null while unlinked, and null again if the account is deleted.
  user_id uuid references public.profiles (id) on delete set null,

  -- Deliberately not a person. `ACSL Admin`, `Administrator`, `Keffi` and
  -- `Gombe` are values the ERP has written into this field that no account
  -- will ever correspond to. Marking them is what stops them sitting in the
  -- unlinked list for ever, being re-examined by everybody who opens it.
  no_account boolean not null default false,

  linked_at timestamptz,
  linked_by uuid references public.profiles (id) on delete set null
);

comment on table data_center.sales_rep_accounts is
  'ERP rep name to app account. The ERP writes a name and not an id, and roughly half have no account - so the link is made by hand and the gap stays visible.';

create index if not exists sales_rep_accounts_user_idx
  on data_center.sales_rep_accounts (user_id) where user_id is not null;


-- ---------------------------------------------------------------------------
-- 3. Seed the links that are already unambiguous
-- ---------------------------------------------------------------------------
--
-- Only exact, case-insensitive, single-candidate matches. A rep name matching
-- two profiles is left unlinked on purpose: guessing which of two people owns
-- 145 consignments is not a decision a migration should take.

-- Folded to one row per rep first, so the profile lookup below is a lookup
-- against a single value rather than a correlated subquery over a grouped
-- column - which is an error, not a slow query.
with reps as (
  select lower(trim(h.sales_rep)) as rep_key,
         min(trim(h.sales_rep))   as rep_name
    from public.stove_transfer_history h
   where h.sales_rep is not null and trim(h.sales_rep) <> ''
   group by lower(trim(h.sales_rep))
),
candidates as (
  select r.rep_key,
         r.rep_name,
         (select p.id from public.profiles p
           where lower(trim(p.full_name)) = r.rep_key limit 1) as user_id,
         (select count(*) from public.profiles p
           where lower(trim(p.full_name)) = r.rep_key)          as matches
    from reps r
)
insert into data_center.sales_rep_accounts (rep_key, rep_name, user_id, linked_at)
select c.rep_key, c.rep_name, c.user_id, now()
  from candidates c
 where c.matches = 1
on conflict (rep_key) do nothing;


-- ---------------------------------------------------------------------------
-- 4. What is waiting, and who it is waiting on
-- ---------------------------------------------------------------------------
--
-- One row per record the call centre has sent back and nobody has resolved,
-- carrying the partner, the stove, the rep as the ERP names them, and the
-- account that rep resolves to. The queue reads this and filters by viewer;
-- the banner counts it.
--
-- A view rather than a table, because every column already exists somewhere
-- else. Storing them again would be a second copy of the truth, and it would
-- go stale the moment a rep mapping was corrected.

create or replace view data_center.v_send_backs as
select
  cr.sale_id,
  s.stove_serial_no,
  s.transaction_id,
  cr.correction_requested_at,
  cr.correction_note,
  ov.label                     as correction_reason,
  cr.correction_requested_by,
  rq.full_name                 as requested_by_name,
  f.organization_id,
  f.partner_name,
  f.transaction_id             as transfer_reference,
  f.sales_rep,
  ra.user_id                   as sales_rep_user_id,
  ra.no_account                as sales_rep_marked_no_account,
  rp.full_name                 as sales_rep_account_name,
  coalesce(cr.corrected_end_user_name, s.end_user_name) as end_user_name,
  coalesce(cr.corrected_phone, s.phone)                 as phone,
  s.sales_date
from data_center.call_records cr
join public.sales s on s.id = cr.sale_id
left join data_center.option_values ov on ov.id = cr.correction_reason_id
left join public.profiles rq on rq.id = cr.correction_requested_by
left join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep))
left join public.profiles rp on rp.id = ra.user_id
where cr.correction_requested_at is not null
  and cr.correction_resolved_at is null
  and s.is_archived is not true;

comment on view data_center.v_send_backs is
  'Records the call centre sent back and nobody has resolved. Routing is computed here, so correcting a rep mapping fixes every send-back already open.';

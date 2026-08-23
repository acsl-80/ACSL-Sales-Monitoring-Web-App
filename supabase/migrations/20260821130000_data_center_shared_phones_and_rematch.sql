-- ===========================================================================
-- Four changes the call centre asked for, all of them about a record being
-- wrong in a way the agent on the phone is the first person able to fix.
--
--   1. One phone can hold more than one stove. A man with two wives buys two
--      stoves and gives one number. Two people still cannot own one stove.
--   2. A stove ID read off the label can disagree with the record, and the
--      agent hearing it read out is the one who can put it right.
--   3. "Doubtful verification" goes. Four outcomes, not five.
--   4. "Name is wrong" and "Address is wrong" stop being reasons to send a
--      sale back to Sales, because the agent corrects those on the call.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Phone numbers holding more than one stove
--
-- The rule was one stove to one phone, enforced in create-sale. It turns out
-- to be wrong about how people buy: one household, one number, two stoves.
--
-- So the number is no longer a key, but it is still a signal - a number
-- appearing twice is usually a typo and occasionally a family, and the two
-- look identical until somebody rings it. This table is where the difference
-- gets recorded: every stove sharing a number, with who noticed and when.
--
-- Kept as one row per (number, sale) rather than a number with a list, because
-- the interesting questions are per stove - which agent confirmed this one, was
-- it flagged at digitalisation or on the call - and a jsonb array of stove ids
-- answers none of them.
-- ---------------------------------------------------------------------------

create table if not exists data_center.shared_phones (
  id            uuid primary key default gen_random_uuid(),

  -- The last ten digits, which is the comparison key everywhere in this
  -- system: create-sale compares by it, idx_sales_phone_tail is built on it,
  -- and it is what makes +234 803..., 0803... and a spreadsheet's 803... one
  -- subscriber.
  phone_tail    text not null check (phone_tail ~ '^[0-9]{10}$'),

  sale_id       uuid not null references public.sales(id) on delete cascade,
  stove_id      text,

  -- As written on the record, so the table can show a person the shapes they
  -- would recognise rather than a normalised key they have never seen.
  phone_as_written text,

  -- Which door it came through. A number flagged at digitalisation is a guess;
  -- one confirmed on a call is a fact, and the surface says which.
  source        text not null default 'digitalisation'
                check (source in ('digitalisation', 'call_centre', 'sales_app')),
  confirmed     boolean not null default false,
  note          text,

  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id),

  -- One row per stove per number. Re-flagging the same pair updates the row
  -- rather than growing the table every time somebody opens the record.
  unique (phone_tail, sale_id)
);

create index if not exists shared_phones_tail_idx on data_center.shared_phones (phone_tail);
create index if not exists shared_phones_sale_idx on data_center.shared_phones (sale_id);

comment on table data_center.shared_phones is
  'Every stove that shares a phone number with another stove. One phone can hold several stoves - one household, one number - but two people cannot own one stove, so this is a register of the legitimate case and a place to catch the mistyped one.';

-- Guarded like every other trigger in this schema since 20260821030000.
-- Postgres has no `create trigger if not exists`, so a bare create makes the
-- whole migration fail on a second run - and that is what stalled the preview
-- branch's migration runner here for two days while hand-applied schema made
-- everything look fine.
drop trigger if exists audit_shared_phones on data_center.shared_phones;
create trigger audit_shared_phones
  after insert or update or delete on data_center.shared_phones
  for each row execute function data_center.log_change('id');


-- ---------------------------------------------------------------------------
-- 2. Stove ID rematches
--
-- The agent has the buyer on the phone reading the number off the label. When
-- it disagrees with the record there are three cases, and only the third is
-- interesting:
--
--   a. The confirmed ID is not in stock at all. Nothing to rematch; it is a
--      misread or a stove that never came through us.
--   b. The confirmed ID is in stock and unsold. Move the sale onto it and
--      release the old one back to available.
--   c. The confirmed ID is already sold to somebody else. Two stoves were
--      swapped in the field. The caller confirming takes precedence, so the
--      two sales exchange stoves - and the OTHER buyer's record is flagged,
--      because nobody has confirmed anything with them and an agent has to.
--
-- This table is the trail. Two sales can move in one act, so the row names
-- both and the flag it raised.
-- ---------------------------------------------------------------------------

create table if not exists data_center.serial_rematches (
  id              uuid primary key default gen_random_uuid(),

  sale_id         uuid not null references public.sales(id) on delete cascade,
  from_serial     text not null,
  to_serial       text not null,

  -- Set only in case (c): the sale that gave up the confirmed stove and
  -- received this one in exchange.
  swapped_with_sale_id uuid references public.sales(id) on delete set null,

  kind            text not null
                  check (kind in ('claimed_available', 'swapped')),
  note            text,

  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id)
);

create index if not exists serial_rematches_sale_idx on data_center.serial_rematches (sale_id);
create index if not exists serial_rematches_swap_idx on data_center.serial_rematches (swapped_with_sale_id);

comment on table data_center.serial_rematches is
  'Every time a call agent moved a sale onto the stove ID the buyer read out. A swap moves two sales at once and flags the buyer who did not ask for it.';


-- The displaced buyer, marked so an agent knows to ring them.
--
-- On call_records rather than a table of its own: it is a fact about the
-- verification of one sale, it clears when somebody confirms, and the queue
-- already reads this row for every record it lists.
alter table data_center.call_records
  add column if not exists serial_unconfirmed_at timestamptz,
  add column if not exists serial_unconfirmed_reason text;

comment on column data_center.call_records.serial_unconfirmed_at is
  'Set when another caller took this record''s stove ID in a rematch. Until an agent confirms which stove this buyer actually has, the record is not verifiable.';


-- ---------------------------------------------------------------------------
-- 3. Four verification outcomes, not five
--
-- "Doubtful verification" sat between partially verified and not verified and
-- meant whatever the agent felt. Nothing downstream could act on it: it is not
-- a state the process moves records out of, and it counted separately in every
-- scorecard for no decision anybody makes. No record has ever carried it.
-- ---------------------------------------------------------------------------

alter table data_center.call_records
  drop constraint if exists call_records_verification_outcome_check;

alter table data_center.call_records
  add constraint call_records_verification_outcome_check
  check (verification_outcome = any (array[
    'fully_verified', 'partially_verified', 'unreachable', 'not_verified'
  ]));


-- ---------------------------------------------------------------------------
-- 4. Two reasons that are no longer reasons
--
-- Sending a sale back to Sales is for things the call centre cannot fix. A
-- wrong name and a wrong address are things it fixes on the call: the agent
-- types the correction and it becomes the record. Leaving them on the list
-- sent work back for no reason and left the correct value sitting unused in
-- the corrected_ column beside it.
--
-- Retired rather than deleted. The rows are referenced by call_records that
-- already used them, and the registry's rule is that a retired option keeps
-- its history and stops being offered.
-- ---------------------------------------------------------------------------

update data_center.option_values
   set is_active = false
 where list_key = 'correction_reason'
   and value in ('wrong_name', 'wrong_address');

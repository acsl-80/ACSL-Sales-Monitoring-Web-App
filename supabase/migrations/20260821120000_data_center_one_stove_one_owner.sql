-- ===========================================================================
-- One stove, one owner, one phone.
--
-- Two rules the business states plainly:
--
--   * no two people own one stove
--   * one stove to one phone number
--
-- Both are already enforced at the only door a sale can come through.
-- create-sale refuses a serial whose stock row reads `sold`, and it refuses a
-- phone whose last ten digits already appear on a live sale - the tail rather
-- than the whole string, so "08031234567" and "+2348031234567" collide the way
-- a person would expect. The Sell Stove form, the digitalisation workbench and
-- the bulk import all commit through that same function, so all three inherit
-- both rules.
--
-- What was missing is the ability to SEE the rule from the record. The stove
-- page is where somebody would notice a violation - it names the buyer, the
-- serial and the phone in one place - and checking whether a phone appears
-- anywhere else meant a full scan of public.sales, which is fine at eleven
-- rows and is not fine at half a million.
--
-- So: an index on the comparison key, matching exactly the expression
-- create-sale compares by. Additive and non-unique; dropping it leaves the
-- sales app exactly as it was.
--
-- WHY THIS IS NOT `CONCURRENTLY`
--
-- The migration runner wraps every migration in a transaction, and
-- CREATE INDEX CONCURRENTLY is rejected inside one, which fails the whole run
-- and leaves a preview branch that never builds. Every environment this file
-- runs in is new - a fresh branch database, a local reset - so the table is
-- empty or tiny and the write lock is instantaneous.
--
-- PRODUCTION IS DIFFERENT AND IS HANDLED SEPARATELY. Run this first, by hand,
-- outside any transaction:
--
--   supabase/manual/20260821_sales_phone_tail_concurrently.sql
--
-- Once that has run, IF NOT EXISTS makes this migration a no-op there, so the
-- two paths converge and neither blocks the other.
--
-- ROLLBACK
--   drop index if exists public.idx_sales_phone_tail;
--
-- DELIBERATELY NOT UNIQUE. A unique index would make the rule impossible to
-- break rather than merely refused, which is stronger and is a decision with
-- consequences outside this module: every other writer to public.sales - the
-- sales app, the mobile app, the ERP reconciliation jobs - would start seeing
-- a raw Postgres constraint error instead of create-sale's sentence explaining
-- which sale already holds the number. That is a change to how the sales app
-- fails, and it is not this module's to make quietly. Recorded in ROADMAP.md
-- as a question for the owner rather than taken here.
-- ===========================================================================

create index if not exists idx_sales_phone_tail
  on public.sales (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10))
  where is_archived is not true;

comment on index public.idx_sales_phone_tail is
  'Last ten digits of the end-user phone, the key create-sale already compares by. Lets the Data Center show whether a number appears on more than one stove without scanning the table. Added by the data_center module; safe to drop if that module is removed.';

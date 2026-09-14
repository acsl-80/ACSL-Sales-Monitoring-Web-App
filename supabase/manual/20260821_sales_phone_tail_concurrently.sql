-- Data Center: the phone comparison key, indexed.
--
-- ###########################################################################
-- ## THIS MIGRATION MUST NOT RUN INSIDE A TRANSACTION.                     ##
-- ## CREATE INDEX CONCURRENTLY is rejected inside one. The Supabase CLI    ##
-- ## wraps migrations in a transaction by default, so apply this file by   ##
-- ## hand (SQL editor or psql), not via `supabase db push`.                ##
-- ###########################################################################
--
-- WHY THIS EXISTS
--
-- Two rules the business states plainly: no two people own one stove, and one
-- stove goes to one phone number. Both are already enforced at the only door a
-- sale can come through - create-sale refuses a serial whose stock row reads
-- `sold`, and refuses a phone whose last ten digits already appear on a live
-- sale. The Sell Stove form, the digitalisation workbench and the bulk import
-- all commit through that function, so all three inherit both rules.
--
-- What was missing is the ability to SEE the rule from a record. The stove page
-- names the buyer, the serial and the phone together, so it is where a
-- violation would be noticed - but asking "is this number on another sale"
-- meant a sequential scan of public.sales with a regexp on every row. Fine at
-- the eleven live sales production holds today. Not fine at 500,000.
--
-- The expression is character-for-character the one create-sale compares by:
-- the last ten digits, so "08031234567" and "+2348031234567" are one
-- subscriber. An index on anything else would not be used.
--
-- WHY NOT UNIQUE
--
-- A unique index would make the rule impossible to break rather than merely
-- refused, which is stronger. It is also a decision with consequences outside
-- this module: every other writer to public.sales would begin seeing a raw
-- Postgres constraint error in place of create-sale's sentence naming the sale
-- that already holds the number, and any legacy row that already violates it
-- would fail the build. That is a change to how the sales app fails, and it is
-- not this module's to make quietly. Left as a question for the owner.
--
-- WHY CONCURRENTLY
--
-- Builds without taking a write lock, so the live Sell Stove path keeps working
-- throughout. The cost is that a failure leaves an INVALID index behind rather
-- than rolling back, which is why the verification step below is not optional.
--
-- ROLLBACK
--   drop index concurrently if exists public.idx_sales_phone_tail;

create index concurrently if not exists idx_sales_phone_tail
  on public.sales (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10))
  where is_archived is not true;

comment on index public.idx_sales_phone_tail is
  'Last ten digits of the end-user phone, the key create-sale already compares by. Lets the Data Center show whether a number appears on more than one stove without scanning the table. Added by the data_center module; safe to drop if that module is removed.';

-- VERIFY IMMEDIATELY AFTER RUNNING. A CONCURRENTLY build that fails leaves an
-- invalid index in place, which is dead weight that also blocks a rebuild:
--
--   select i.indisvalid, c.relname
--   from pg_index i join pg_class c on c.oid = i.indexrelid
--   where c.relname = 'idx_sales_phone_tail';
--
-- indisvalid must be true. If it is false:
--   drop index concurrently public.idx_sales_phone_tail;
-- then investigate before retrying.

-- AND WHILE YOU ARE HERE: confirm the rule actually holds in production before
-- trusting any page that reports on it. Both counts must be zero.
--
--   select
--     (select count(*) from (
--        select upper(trim(stove_serial_no))
--          from public.sales
--         where is_archived is not true and stove_serial_no is not null
--         group by 1 having count(*) > 1) x) as serials_on_two_sales,
--     (select count(*) from (
--        select right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'), 10)
--          from public.sales
--         where is_archived is not true
--           and length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) >= 10
--         group by 1 having count(*) > 1) y) as phones_on_two_sales;

-- ===========================================================================
-- The sales app's status rule matches its own form (decision D1).
--
-- Three implementations of one rule disagreed. The BEFORE trigger function
-- calculate_sale_status() and the row function calculate_sale_status(sales)
-- both still required a stove photo and an agreement document that the Sell
-- Stove form made optional, and the row function ran last, so every live sale
-- read incomplete whatever the TypeScript mirror (_shared/saleStatus.ts) had
-- computed for it. On 2026-09-05 production held 2,340 live sales and every
-- one of them read incomplete.
--
-- This is the host lane: a function and triggers on public.sales, and a
-- recompute of the status column. Nothing about it belongs to the Data
-- Center module, which keeps its own completeness rule in workflow_config.
--
-- The rule, after this file, is the form's rule as _shared/saleStatus.ts
-- already states it:
--   completed   every required field present and a valid signature
--   pending     every required field present, signature missing or invalid
--   incomplete  at least one required field missing
-- Required: transaction id, stove serial, sale date, contact person, contact
-- phone, end user name, phone, partner name, amount, state, LGA, and an
-- address line. The two images are not part of it.
-- ===========================================================================

create or replace function public.calculate_sale_status(sale_record public.sales)
returns text
language plpgsql
stable
as $function$
declare
  sig text := trim(coalesce(sale_record.signature, ''));
  has_address boolean;
begin
  -- The address line lives on public.addresses, reached by address_id, which
  -- is why this function is stable and not immutable.
  select exists (
    select 1 from public.addresses a
     where a.id = sale_record.address_id
       and nullif(trim(coalesce(a.full_address, '')), '') is not null
  ) into has_address;

  if nullif(trim(coalesce(sale_record.transaction_id, '')), '') is null
     or nullif(trim(coalesce(sale_record.stove_serial_no, '')), '') is null
     or sale_record.sales_date is null
     or nullif(trim(coalesce(sale_record.contact_person, '')), '') is null
     or nullif(trim(coalesce(sale_record.contact_phone, '')), '') is null
     or nullif(trim(coalesce(sale_record.end_user_name, '')), '') is null
     or nullif(trim(coalesce(sale_record.phone, '')), '') is null
     or nullif(trim(coalesce(sale_record.partner_name, '')), '') is null
     or sale_record.amount is null
     or nullif(trim(coalesce(sale_record.state_backup, '')), '') is null
     or nullif(trim(coalesce(sale_record.lga_backup, '')), '') is null
     or not has_address then
    return 'incomplete';
  end if;

  -- isValidSignature in _shared/saleStatus.ts: a data URL longer than its
  -- prefix, or any other string longer than a hundred characters.
  if sig <> '' and (
       (sig like 'data:image/%' and length(sig) > 22)
       or (sig not like 'data:image/%' and length(sig) > 100)) then
    return 'completed';
  end if;
  return 'pending';
end;
$function$;

comment on function public.calculate_sale_status(public.sales) is
  'The sales form''s own completeness rule, mirroring _shared/saleStatus.ts: completed with every required field and a valid signature, pending without the signature, incomplete with a required field missing. The two images are optional, as they are on the form. The one place this rule lives in SQL; update_sale_status() applies it before every insert and update.';

-- One trigger, one rule. The two triggers on the zero-argument function ran
-- first and were overwritten by the third; they and their function go.
drop trigger if exists sales_status_calculation_insert on public.sales;
drop trigger if exists sales_status_calculation_update on public.sales;
drop function if exists public.calculate_sale_status();

-- trigger_update_sale_status stays as the one BEFORE INSERT OR UPDATE trigger,
-- calling update_sale_status(), which calls the function above.

-- ---------------------------------------------------------------------------
-- Recompute the column. Only rows whose status would change are written, so
-- the history trigger records a status change for exactly those, and nothing
-- else about any sale moves. The old trigger wrote a status that could not
-- have been right for any live sale, so every row it touched is one where the
-- stored word disagreed with the form.
-- ---------------------------------------------------------------------------

do $$
declare
  before_counts text;
  after_counts text;
  changed integer;
begin
  select string_agg(status || '=' || n, ', ' order by status)
    into before_counts
    from (select coalesce(status, 'null') as status, count(*) as n from public.sales group by 1) c;

  update public.sales s
     set status = public.calculate_sale_status(s)
   where s.status is distinct from public.calculate_sale_status(s);
  get diagnostics changed = row_count;

  select string_agg(status || '=' || n, ', ' order by status)
    into after_counts
    from (select coalesce(status, 'null') as status, count(*) as n from public.sales group by 1) c;

  raise notice 'sale status rule: % rows recomputed; before: %; after: %', changed, before_counts, after_counts;
end;
$$;

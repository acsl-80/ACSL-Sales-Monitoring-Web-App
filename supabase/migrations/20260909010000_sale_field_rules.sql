-- ===========================================================================
-- "Mandatory" carries a date, and one table says which (A5, D29; slice F3a).
-- Host lane, on his word: one additive table in public, and the sales app's
-- status rule reads it instead of a list written into the function.
--
-- public.sale_field_rules holds one row per sale field that a sale must carry
-- from a date. The sales app's rule (calculate_sale_status) reads the rows
-- marked sales_app; the Data Center's completeness rule reads the rows marked
-- data_center on top of its own baseline (D25); the dictionary endpoint serves
-- the dates to the phone app; the web forms refuse a new record without a
-- field the rules require for its date. Moving a date is configuration.
--
-- A sale is judged by the rule of its day: a row's date is compared with the
-- sale's date, so a record made before a rule is never made incomplete by it.
-- The baseline rows carry 2000-01-01 and reproduce slice 7b's list minus the
-- contact pair (A4). Every dated row post-dates every live sale (they run
-- 2026-02 to 2026-09), so no verdict on history moves today.
-- ===========================================================================

create table if not exists public.sale_field_rules (
  field_key      text primary key,
  table_name     text not null default 'sales'
                 constraint sale_field_rules_table_check check (table_name in ('sales', 'addresses')),
  column_name    text not null,
  mandatory_from date not null,
  applies_to     text[] not null default array['sales_app', 'data_center']
                 constraint sale_field_rules_applies_check
                 check (applies_to <@ array['sales_app', 'data_center'] and cardinality(applies_to) > 0),
  note           text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

comment on table public.sale_field_rules is
  'Per sale field, the date from which a sale must carry it. field_key is the dictionary key (supabase/functions/_shared/sale-dictionary.json); table_name and column_name say where the value lives. applies_to names the rules that read the row: sales_app is public.calculate_sale_status, data_center is data_center.completeness_predicate. A sale is judged against rows whose date is on or before its sales date.';
comment on column public.sale_field_rules.mandatory_from is 'A sale dated on or after this day must carry the field. 2000-01-01 means since the form existed.';
comment on column public.sale_field_rules.applies_to is 'Which rules read this row: sales_app, data_center, or both.';

-- A row naming a column that does not exist would judge every sale
-- incomplete for a value nothing can hold. Refuse it at the door.
create or replace function public.sale_field_rules_check_column()
returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = new.table_name and column_name = new.column_name
  ) then
    raise exception 'sale_field_rules: % is not a column of public.%', new.column_name, new.table_name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sale_field_rules_check_column on public.sale_field_rules;
create trigger sale_field_rules_check_column
  before insert or update on public.sale_field_rules
  for each row execute function public.sale_field_rules_check_column();

alter table public.sale_field_rules enable row level security;

-- Any signed-in user may read the rules: the forms and the phone app need
-- them to say what a new record must carry. Writes go through
-- data-center-admin with the service role, which bypasses these policies.
drop policy if exists sale_field_rules_read on public.sale_field_rules;
create policy sale_field_rules_read on public.sale_field_rules
  for select to authenticated using (true);
grant select on public.sale_field_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Seed. on conflict do nothing: a date moved in Settings is never reset by a
-- redeploy of this file.
-- ---------------------------------------------------------------------------
insert into public.sale_field_rules (field_key, table_name, column_name, mandatory_from, applies_to, note) values
  -- The form's own rule since the form existed (slice 7b's list, A4 aside).
  ('transaction_id',   'sales',     'transaction_id',     date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('stove_serial_no',  'sales',     'stove_serial_no',    date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('sales_date',       'sales',     'sales_date',         date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('end_user_name',    'sales',     'end_user_name',      date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('phone',            'sales',     'phone',              date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('partner_name',     'sales',     'partner_name',       date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('amount',           'sales',     'amount',             date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('state_backup',     'sales',     'state_backup',       date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  ('lga_backup',       'sales',     'lga_backup',         date '2000-01-01', array['sales_app'], 'Since the form existed. The call centre fills it on digitised receipts, which is why the Data Center does not read this row.'),
  ('full_address',     'addresses', 'full_address',       date '2000-01-01', array['sales_app'], 'Since the form existed.'),
  -- From go-live of the field alignment (Phase 25): "now" in the proposal.
  ('end_user_surname',   'sales',     'end_user_surname',   date '2026-09-08', array['sales_app', 'data_center'], 'A2: the name in two parts.'),
  ('end_user_first_name','sales',     'end_user_first_name', date '2026-09-08', array['sales_app', 'data_center'], 'A2: the name in two parts.'),
  ('city',               'addresses', 'city',               date '2026-09-08', array['sales_app', 'data_center'], 'A3: City/town/village, a field of its own.'),
  ('sales_agent_name',   'sales',     'selling_agent_name', date '2026-09-08', array['sales_app', 'data_center'], 'A8: the agent as written on the agreement.'),
  ('previous_stove_type','sales',     'previous_stove_type', date '2026-09-08', array['sales_app', 'data_center'], 'A7: the baseline stove.'),
  ('terms_accepted',     'sales',     'terms_accepted',     date '2026-09-08', array['sales_app', 'data_center'], 'D27: CPA is the six consents.'),
  -- Four months out (A5).
  ('pot_quantity',         'sales', 'pot_quantity',          date '2027-01-05', array['sales_app', 'data_center'], 'A5: four months after go-live.'),
  ('heat_retention_device','sales', 'heat_retention_device', date '2027-01-05', array['sales_app', 'data_center'], 'A5: four months after go-live.'),
  ('cooking_fuel_source',  'sales', 'cooking_fuel_source',   date '2027-01-05', array['sales_app', 'data_center'], 'A5: four months after go-live; a choice from slice F3b.')
on conflict (field_key) do nothing;

-- ---------------------------------------------------------------------------
-- The sales app's status rule reads the table. Same verdicts as slice 7b for
-- every live sale: completed with every required field and a valid
-- signature, pending without the signature, incomplete with a required field
-- missing. The two images stay optional, as they are on the form.
-- ---------------------------------------------------------------------------
create or replace function public.calculate_sale_status(sale_record public.sales)
returns text
language plpgsql
stable
as $function$
declare
  sig text := trim(coalesce(sale_record.signature, ''));
  on_day date := coalesce(sale_record.sales_date::date, current_date);
  sale_json jsonb := to_jsonb(sale_record);
  addr_json jsonb;
  r record;
begin
  -- The address columns live on public.addresses, reached by address_id,
  -- which is why this function is stable and not immutable.
  select to_jsonb(a) into addr_json from public.addresses a where a.id = sale_record.address_id;

  for r in
    select table_name, column_name
      from public.sale_field_rules
     where 'sales_app' = any(applies_to)
       and mandatory_from <= on_day
     order by field_key
  loop
    if r.table_name = 'addresses' then
      if addr_json is null or nullif(trim(coalesce(addr_json ->> r.column_name, '')), '') is null then
        return 'incomplete';
      end if;
    elsif nullif(trim(coalesce(sale_json ->> r.column_name, '')), '') is null then
      return 'incomplete';
    end if;
  end loop;

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
  'The sales form''s completeness rule, read from public.sale_field_rules: a sale must carry every field whose rule date is on or before its sales date (rows marked sales_app). Completed with those fields and a valid signature, pending without the signature, incomplete with a field missing. The two images are optional, as on the form. update_sale_status() applies it before every insert and update.';

-- Readback: how many verdicts move. Expected 0 on production, because the
-- baseline rows are 7b's list and every dated row post-dates every live sale.
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
     set status = public.calculate_sale_status(s), updated_at = now()
   where s.status is distinct from public.calculate_sale_status(s);
  get diagnostics changed = row_count;
  select string_agg(status || '=' || n, ', ' order by status)
    into after_counts
    from (select coalesce(status, 'null') as status, count(*) as n from public.sales group by 1) c;
  raise notice 'sale field rules: % verdicts moved; before: %; after: %', changed, before_counts, after_counts;
end;
$$;

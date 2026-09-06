-- ===========================================================================
-- Data Center, slice F3a: the completeness rule reads the dated rules too.
--
-- The module's baseline stays its own: completeness_required_fields and
-- completeness_evidence_any_of in workflow_config (D25), because the call
-- centre fills what a digitised receipt lacks and the module counts that work
-- as done. On top of it, every row of public.sale_field_rules marked
-- data_center adds one clause: a sale dated on or after the row's date must
-- carry the field; a sale dated before it is judged by the rule of its day.
-- ===========================================================================

-- The presence predicate learns the addresses table, reached by address_id.
-- The two-argument version goes first: left in place beside a three-argument
-- one with a default, every two-argument call would be ambiguous. Its callers
-- are plpgsql bodies, bound at run time, so nothing breaks in between.
drop function if exists data_center.field_present_predicate(text, text);
create or replace function data_center.field_present_predicate(p_field text, p_alias text default 's', p_table text default 'sales')
returns text
language plpgsql stable as $$
declare
  col_type text;
begin
  if p_table not in ('sales', 'addresses') then
    raise exception 'the completeness rule names table %, which it does not read', p_table;
  end if;

  select data_type into col_type
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name = p_field;

  if col_type is null then
    raise exception 'the completeness rule names %, which is not a column of public.%', p_field, p_table;
  end if;

  if p_table = 'addresses' then
    if col_type in ('text', 'character varying', 'character') then
      return format('exists (select 1 from public.addresses a_ where a_.id = %I.address_id and nullif(trim(coalesce(a_.%I, %L)), %L) is not null)', p_alias, p_field, '', '');
    end if;
    return format('exists (select 1 from public.addresses a_ where a_.id = %I.address_id and a_.%I is not null)', p_alias, p_field);
  end if;

  if col_type in ('text', 'character varying', 'character') then
    return format('nullif(trim(coalesce(%I.%I, %L)), %L) is not null', p_alias, p_field, '', '');
  end if;
  return format('%I.%I is not null', p_alias, p_field);
end;
$$;

comment on function data_center.field_present_predicate is
  'The predicate that says one column is present: non-blank for text, non-null otherwise. Columns of public.sales directly, columns of public.addresses through address_id. The column is validated against the catalogue.';

-- The dated clauses, one per data_center row of the rules table.
create or replace function data_center.dated_rules_predicate(p_alias text default 's')
returns text
language plpgsql stable as $$
declare
  r record;
  parts text[] := '{}';
begin
  for r in
    select table_name, column_name, mandatory_from
      from public.sale_field_rules
     where 'data_center' = any(applies_to)
     order by mandatory_from, field_key
  loop
    parts := parts || format(
      '(%I.sales_date::date < %L or %s)',
      p_alias, r.mandatory_from::text,
      data_center.field_present_predicate(r.column_name, p_alias, r.table_name)
    );
  end loop;
  if array_length(parts, 1) is null then
    return null;
  end if;
  return array_to_string(parts, ' and ');
end;
$$;

comment on function data_center.dated_rules_predicate is
  'One clause per row of public.sale_field_rules marked data_center: a sale dated on or after the row''s date carries the field, a sale dated before it is judged by the rule of its day. Null when the table has no such row.';

create or replace function data_center.completeness_predicate(alias text default 's')
returns text
language plpgsql stable as $$
declare
  fields text[];
  f text;
  parts text[] := '{}';
  evidence text;
  dated text;
begin
  select array(select jsonb_array_elements_text(value))
    into fields
    from data_center.workflow_config
   where key = 'completeness_required_fields';

  -- No rule configured means nothing is claimed complete, rather than
  -- everything being claimed complete.
  if fields is null or array_length(fields, 1) is null then
    return 'false';
  end if;

  foreach f in array fields loop
    parts := parts || data_center.field_present_predicate(f, alias);
  end loop;

  evidence := data_center.completeness_evidence_predicate(alias);
  if evidence is not null then
    parts := parts || evidence;
  end if;

  dated := data_center.dated_rules_predicate(alias);
  if dated is not null then
    parts := parts || dated;
  end if;

  return array_to_string(parts, ' and ');
end;
$$;

comment on function data_center.completeness_predicate is
  'The module completeness rule as plain column predicates: every field in completeness_required_fields, any one of completeness_evidence_any_of, and every dated rule of public.sale_field_rules marked data_center, each gated on the sale''s date. Column names are validated against the catalogue, so config cannot become SQL.';

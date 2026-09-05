-- ===========================================================================
-- The sale record carries the agreement's fields as its own columns (D29,
-- slice F2). Host lane: additive columns on public.sales, one trigger that
-- keeps the customer's name in two forms, and two backfills that mark
-- themselves. Nothing is renamed and nothing is dropped.
--
--   end_user_surname, end_user_first_name   the agreement's two name fields.
--                                          end_user_name stays as the joined
--                                          form for every reader of it.
--   name_split_source                      how the two parts came to be:
--                                          entered (a form or sheet gave
--                                          both), rule (split from the joined
--                                          name: first word, then the rest),
--                                          confirmed (the call centre checked
--                                          a rule split).
--   selling_agent_name, selling_agent_user_id  the agent as written, and the
--                                          account when the agent has one.
--                                          Not the typist: created_by keeps
--                                          naming whoever made the record, and
--                                          the module's sale_agent_name (the
--                                          creator's name) keeps its meaning.
--   cooking_fuel_source_note,
--   cooking_location_note                  where the free text goes when F3
--                                          turns those two answers into
--                                          choices, so nothing is lost.
-- ===========================================================================

alter table public.sales
  add column if not exists end_user_first_name text,
  add column if not exists end_user_surname text,
  add column if not exists name_split_source text,
  add column if not exists selling_agent_name text,
  add column if not exists selling_agent_user_id uuid references public.profiles (id) on delete set null,
  add column if not exists cooking_fuel_source_note text,
  add column if not exists cooking_location_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_name_split_source_check') then
    alter table public.sales
      add constraint sales_name_split_source_check
      check (name_split_source is null or name_split_source in ('entered', 'rule', 'confirmed'));
  end if;
end $$;

comment on column public.sales.end_user_first_name is 'The agreement''s First name. With end_user_surname it composes end_user_name.';
comment on column public.sales.end_user_surname is 'The agreement''s Surname.';
comment on column public.sales.name_split_source is 'entered: a writer gave both parts; rule: split from end_user_name as first word then the rest; confirmed: the call centre checked a rule split.';
comment on column public.sales.selling_agent_name is 'The sales agent''s name as written on the agreement or chosen on the form. Not the typist: created_by is whoever made the record.';
comment on column public.sales.selling_agent_user_id is 'The agent''s account when the agent has one.';
comment on column public.sales.cooking_fuel_source_note is 'The original free-text answer for Fuel source, kept when the column became a choice.';
comment on column public.sales.cooking_location_note is 'The original free-text answer for Cooking location, kept when the column became a choice.';

create index if not exists sales_selling_agent_user_id_idx on public.sales (selling_agent_user_id) where selling_agent_user_id is not null;

-- ---------------------------------------------------------------------------
-- One name, two forms, kept in step by the row itself.
--
-- A writer that knows the parts (the web form, the bench, the sheet) sends
-- both and gets the joined name composed for it. A writer that knows only
-- the joined name (the phone app until it is updated, older callers) gets
-- the parts split by rule and marked as such. A later edit to the joined name
-- alone re-splits it, so the two forms never disagree; an edit to the parts
-- recomposes the joined name.
--
-- BEFORE triggers on one table fire in name order. This one is named to run
-- before trigger_update_sale_status, which reads end_user_name for the
-- status rule, so the status sees the composed name.
-- ---------------------------------------------------------------------------

create or replace function public.sales_name_parts()
returns trigger
language plpgsql as $$
declare
  joined text := nullif(trim(coalesce(new.end_user_name, '')), '');
  first_part text := nullif(trim(coalesce(new.end_user_first_name, '')), '');
  sur_part text := nullif(trim(coalesce(new.end_user_surname, '')), '');
  parts_changed boolean;
  joined_changed boolean;
begin
  if tg_op = 'INSERT' then
    parts_changed := first_part is not null or sur_part is not null;
    joined_changed := joined is not null;
  else
    parts_changed := new.end_user_first_name is distinct from old.end_user_first_name
                  or new.end_user_surname is distinct from old.end_user_surname;
    joined_changed := new.end_user_name is distinct from old.end_user_name;
  end if;

  if parts_changed then
    -- The parts are the truth; compose the joined name from them.
    new.end_user_first_name := first_part;
    new.end_user_surname := sur_part;
    new.end_user_name := nullif(trim(concat_ws(' ', first_part, sur_part)), '');
    if new.name_split_source is null or new.name_split_source = 'rule' then
      new.name_split_source := 'entered';
    end if;
  elsif joined_changed and joined is not null then
    -- Only the joined name moved: split it by rule and say so.
    new.end_user_first_name := split_part(joined, ' ', 1);
    new.end_user_surname := nullif(trim(substr(joined, length(split_part(joined, ' ', 1)) + 1)), '');
    if new.end_user_surname is null then
      -- One word is a surname with no first name, as the agreement reads it.
      new.end_user_surname := new.end_user_first_name;
      new.end_user_first_name := null;
    end if;
    new.name_split_source := 'rule';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_a_name_parts on public.sales;
create trigger sales_a_name_parts
  before insert or update of end_user_name, end_user_first_name, end_user_surname on public.sales
  for each row execute function public.sales_name_parts();

comment on function public.sales_name_parts is
  'Keeps end_user_name and its two parts in step: parts given compose the joined name and mark entered; a joined name alone is split by rule (first word, then the rest; one word is the surname) and marked rule. Named to fire before trigger_update_sale_status.';

-- ---------------------------------------------------------------------------
-- History: the 2,340 live and 32 archived sales that have a joined name and
-- no parts are split by the same rule and marked rule, so the call centre can
-- confirm or correct them one by one. The trigger is bypassed on purpose: the
-- update names the parts directly, which the trigger would treat as entered.
-- ---------------------------------------------------------------------------

alter table public.sales disable trigger sales_a_name_parts;

update public.sales s
   set end_user_first_name = case when position(' ' in trim(s.end_user_name)) > 0
                                  then split_part(trim(s.end_user_name), ' ', 1) end,
       end_user_surname = case when position(' ' in trim(s.end_user_name)) > 0
                               then nullif(trim(substr(trim(s.end_user_name), length(split_part(trim(s.end_user_name), ' ', 1)) + 1)), '')
                               else trim(s.end_user_name) end,
       name_split_source = 'rule'
 where nullif(trim(coalesce(s.end_user_name, '')), '') is not null
   and s.end_user_first_name is null and s.end_user_surname is null;

alter table public.sales enable trigger sales_a_name_parts;

-- ---------------------------------------------------------------------------
-- History: the sales agent. A record made in the sales app was made by the
-- agent who sold the stove, so its creator's name is the agent's. A record
-- that came through an import was made by a typist, and the agent's name was
-- not on the sheet, so it stays empty until the call centre or F3's sheet
-- column supplies it.
-- ---------------------------------------------------------------------------

update public.sales s
   set selling_agent_name = p.full_name,
       selling_agent_user_id = p.id
  from public.profiles p
 where p.id = s.created_by
   and s.selling_agent_name is null
   and nullif(trim(coalesce(p.full_name, '')), '') is not null
   and not exists (select 1 from data_center.import_rows r where r.sale_id = s.id);

do $$
declare
  split_rule integer; single integer; agents integer; live integer;
begin
  select count(*) filter (where name_split_source = 'rule'),
         count(*) filter (where name_split_source = 'rule' and end_user_first_name is null),
         count(*) filter (where selling_agent_name is not null),
         count(*) filter (where is_archived is not true)
    into split_rule, single, agents, live
    from public.sales;
  raise notice 'sale record fields: % names split by rule (% single-word), % sales carry an agent name, % live sales', split_rule, single, agents, live;
end $$;

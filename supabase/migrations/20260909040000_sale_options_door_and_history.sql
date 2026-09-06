-- ===========================================================================
-- Slice F3b, host lane on his word: one narrow door onto the sale's option
-- lists, and history mapped onto them with the original words kept (A6, A7).
--
-- The Data Center schema stays out of PostgREST; that isolation is the
-- module's guarantee. The sales app, the phone app and create-sale still need
-- the three lists the sale record now draws from, so one function in public
-- returns exactly those three and nothing else. It runs as its owner, so the
-- caller needs no grant on the schema behind it.
--
-- History: 1,058 sales say wood_stove and become firewood; 62 carry free-text
-- fuel or location answers, mapped by the rules the proposal named (market,
-- buying and kasuwa to purchase; farm to collect; kitchen to indoor; outdoors
-- to outdoor). What the rules cannot place keeps its words in the note column
-- and leaves the choice empty for the call centre. Nothing is lost: the note
-- columns hold every original, so the mapping reverses from them.
-- ===========================================================================

create or replace function public.sale_options(p_list text default null)
returns table (list_key text, value text, label text, is_active boolean, sort_order integer)
language sql
stable
security definer
set search_path = public, data_center
as $$
  select v.list_key, v.value, v.label, v.is_active, v.sort_order
    from data_center.option_values v
   where v.list_key in ('baseline_stove', 'fuel_source', 'cooking_location')
     and (p_list is null or v.list_key = p_list)
   order by v.list_key, v.sort_order, v.label
$$;

revoke all on function public.sale_options(text) from public;
grant execute on function public.sale_options(text) to authenticated, service_role;

comment on function public.sale_options(text) is
  'The sale record''s three option lists (baseline_stove, fuel_source, cooking_location) from the Data Center registry, retired values included with is_active false. The one door the host has onto data_center.option_values; the schema itself stays out of PostgREST. Read by sale-dictionary, create-sale, update-sale and the phone app.';

-- ---------------------------------------------------------------------------
-- History onto the lists. The note columns from slice F2 hold the originals.
-- ---------------------------------------------------------------------------
do $$
declare
  stoves integer;
  fuel_rows integer;
  fuel_placed integer;
  loc_rows integer;
  loc_placed integer;
begin
  update public.sales
     set previous_stove_type = 'firewood'
   where previous_stove_type = 'wood_stove';
  get diagnostics stoves = row_count;

  update public.sales
     set cooking_fuel_source_note = coalesce(cooking_fuel_source_note, cooking_fuel_source),
         cooking_fuel_source = case
           when lower(cooking_fuel_source) ~ '(market|buy|kasuwa|purchas|shop|vendor)' then 'purchase'
           when lower(cooking_fuel_source) ~ '(farm|collect|bush|gather|fetch)' then 'collect'
           else null
         end
   where cooking_fuel_source is not null
     and cooking_fuel_source not in ('collect', 'purchase');
  get diagnostics fuel_rows = row_count;
  select count(*) into fuel_placed from public.sales
   where cooking_fuel_source_note is not null and cooking_fuel_source is not null;

  update public.sales
     set cooking_location_note = coalesce(cooking_location_note, cooking_location),
         cooking_location = case
           when lower(cooking_location) ~ 'semi' then 'semi_indoor'
           when lower(cooking_location) ~ '(kitchen|indoor|inside|room)' then 'indoor'
           when lower(cooking_location) ~ '(outdoor|outside|open|compound|yard)' then 'outdoor'
           else null
         end
   where cooking_location is not null
     and cooking_location not in ('indoor', 'outdoor', 'semi_indoor');
  get diagnostics loc_rows = row_count;
  select count(*) into loc_placed from public.sales
   where cooking_location_note is not null and cooking_location is not null;

  raise notice 'sale options: % stoves wood_stove to firewood; fuel: % free-text rows, % placed; location: % free-text rows, % placed; the rest keep their words in the note columns',
    stoves, fuel_rows, fuel_placed, loc_rows, loc_placed;
end;
$$;

-- ===========================================================================
-- Data Center, slice F3b: the sale's three choices are option lists (A6, A7).
--
-- Fuel source and cooking location become lists the agreement names. The
-- baseline stove list the call form already uses becomes the one list for
-- the sale and the call: Firewood, Charcoal, LPG. The call form's older
-- wording retires but stays readable on the calls that picked it; "Other"
-- exists retired, so a sale that said other still renders and no new record
-- can pick it. The digitisation sheet's three columns point at the lists
-- instead of carrying a copy of the choices.
--
-- Values are the words stored on public.sales; labels are what a person
-- reads. Renaming a label never rewrites a record.
-- ===========================================================================

insert into data_center.option_lists (key, label, description) values
  ('fuel_source',      'Fuel source',      'Where the household gets its cooking fuel, as the agreement asks: collected or purchased.'),
  ('cooking_location', 'Cooking location', 'Where the household cooks: indoor, outdoor or semi-indoor.')
on conflict (key) do nothing;

update data_center.option_lists
   set description = 'The stove the household cooked on before the Save80: one list for the sale record and the call form (A7).'
 where key = 'baseline_stove';

insert into data_center.option_values (list_key, value, label, sort_order, is_active) values
  ('fuel_source',      'collect',     'Collect it',  1, true),
  ('fuel_source',      'purchase',    'Purchase it', 2, true),
  ('cooking_location', 'indoor',      'Indoor',      1, true),
  ('cooking_location', 'outdoor',     'Outdoor',     2, true),
  ('cooking_location', 'semi_indoor', 'Semi-indoor', 3, true),
  ('baseline_stove',   'firewood',    'Firewood',    1, true),
  ('baseline_stove',   'charcoal',    'Charcoal',    2, true),
  ('baseline_stove',   'other',       'Other',      99, false)
on conflict (list_key, value) do nothing;

update data_center.option_values
   set label = 'LPG', sort_order = 3, is_active = true
 where list_key = 'baseline_stove' and value = 'lpg';

-- The call form's five older choices retire. A call that picked one keeps
-- its answer, and the form shows the retired label beside it.
update data_center.option_values
   set is_active = false
 where list_key = 'baseline_stove'
   and value in ('traditional_charcoal', 'three_stone_firewood', 'traditional_firewood_metal', 'electric_hotplate');

-- The sheet's three columns read their choices from the lists. The read
-- resolves optionList into the labels when it builds the sheet, so a value
-- retired in Settings leaves the dropdown without a release.
update data_center.workflow_config w
   set value = (
     select coalesce(jsonb_agg(
       case c ->> 'field'
         when 'previousStoveType' then (c - 'options') || '{"type":"list","optionList":"baseline_stove","help":"The stove the household cooked on before. Pick one."}'::jsonb
         when 'cookingFuelSource' then (c - 'options') || '{"type":"list","optionList":"fuel_source","help":"Collect it or Purchase it, as the agreement asks."}'::jsonb
         when 'cookingLocation'   then (c - 'options') || '{"type":"list","optionList":"cooking_location","help":"Indoor, Outdoor or Semi-indoor."}'::jsonb
         else c
       end
       order by t.ord), '[]'::jsonb)
       from jsonb_array_elements(w.value) with ordinality as t(c, ord))
 where w.key = 'digitisation.sheet_columns';

-- ===========================================================================
-- Two columns the agreement has and the sheet did not: the city and the agent.
--
-- CITY IS NOT THE LGA
--
-- The digitalisation sheet asked for State, LGA and Address, and nothing for
-- the town. `addresses.city` still had to be filled, so the import filled it
-- from the LGA - which meant every imported sale recorded a local government
-- area where the form records a town, and the two could never be told apart
-- afterwards. The sheet now asks the question the form asks, right after the
-- address, and the importer stops borrowing.
--
-- THE AGENT IS NOT THE TYPIST, AND NOT THE REP EITHER
--
-- "Sales Rep" already on the sheet is the consignment's rep, filled in from the
-- transfer and locked. The agent who actually sold the stove is written on the
-- paper agreement, is often somebody else, and had nowhere to go. It sits right
-- after the rep so a typist reads the two together and can see they differ.
--
-- Neither is required. The columns are new, the receipts in the stack were
-- written before they existed, and refusing a row for a field nobody was given
-- is the check costing more than it catches.
--
-- Only `data_center.workflow_config` changes here: no schema, no `public`.
-- The columns each object feeds - `addresses.city` and
-- `sales.selling_agent_name` - both already exist.
--
-- IDEMPOTENT
--
-- Each update runs only when no column with that field is present, so applying
-- this twice adds nothing the second time. A new migration rather than an edit
-- to an applied one, for the reason 20260831090000 wrote down: an applied
-- migration does not re-run.
--
-- Rollback:
--   update data_center.workflow_config w
--      set value = (select coalesce(jsonb_agg(col order by ord), '[]'::jsonb)
--                     from jsonb_array_elements(w.value) with ordinality as t(col, ord)
--                    where col ->> 'field' not in ('city', 'salesAgentName'))
--    where w.key = 'digitisation.sheet_columns';
-- ===========================================================================

-- City/town/village, immediately after the address.
--
-- Each existing column expands to itself, and the anchor expands to itself plus
-- the new one. `sub` keeps the pair in that order; every other column is
-- carried through byte for byte.
update data_center.workflow_config w
   set value = (
         select coalesce(jsonb_agg(e.item order by t.ord, e.sub), '[]'::jsonb)
           from jsonb_array_elements(w.value) with ordinality as t(col, ord)
           cross join lateral (
             select t.col as item, 0 as sub
             union all
             select '{"field":"city","header":"City/town/village","required":false,"type":"text"}'::jsonb,
                    1
              where t.col ->> 'field' = 'fullAddress'
           ) e
       )
 where w.key = 'digitisation.sheet_columns'
   and exists (
     select 1 from jsonb_array_elements(w.value) e where e ->> 'field' = 'fullAddress'
   )
   and not exists (
     select 1 from jsonb_array_elements(w.value) e where e ->> 'field' = 'city'
   );

-- The agent named on the agreement, immediately after the consignment's rep.
update data_center.workflow_config w
   set value = (
         select coalesce(jsonb_agg(e.item order by t.ord, e.sub), '[]'::jsonb)
           from jsonb_array_elements(w.value) with ordinality as t(col, ord)
           cross join lateral (
             select t.col as item, 0 as sub
             union all
             select jsonb_build_object(
                      'field', 'salesAgentName',
                      'header', 'Sales agent''s name',
                      'required', false,
                      'type', 'text',
                      'help', 'As written on the agreement. Leave empty if it is not there.'
                    ),
                    1
              where t.col ->> 'field' = 'salesRep'
           ) e
       )
 where w.key = 'digitisation.sheet_columns'
   and exists (
     select 1 from jsonb_array_elements(w.value) e where e ->> 'field' = 'salesRep'
   )
   and not exists (
     select 1 from jsonb_array_elements(w.value) e where e ->> 'field' = 'salesAgentName'
   );

-- Say what landed, so a run that anchored nothing is visible rather than quiet.
do $$
declare
  city_at integer; agent_at integer; total integer;
begin
  select count(*)::int,
         (min(ord) filter (where col ->> 'field' = 'city'))::int,
         (min(ord) filter (where col ->> 'field' = 'salesAgentName'))::int
    into total, city_at, agent_at
    from data_center.workflow_config w,
         lateral jsonb_array_elements(w.value) with ordinality as t(col, ord)
   where w.key = 'digitisation.sheet_columns';
  raise notice 'digitisation sheet: % columns, city at %, salesAgentName at %',
    total, coalesce(city_at::text, 'absent'), coalesce(agent_at::text, 'absent');
end $$;

-- What it should say afterwards, to paste back:
--
--   select c.ord, c.col ->> 'field' as field, c.col ->> 'header' as header
--     from data_center.workflow_config,
--          lateral jsonb_array_elements(value) with ordinality as c(col, ord)
--    where key = 'digitisation.sheet_columns'
--    order by c.ord;

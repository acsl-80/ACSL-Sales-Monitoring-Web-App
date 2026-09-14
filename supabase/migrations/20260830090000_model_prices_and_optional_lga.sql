-- Two settings the digitisation import needs to run on the real sheet.
--
-- Both are decisions, not defaults, so they are recorded here rather than
-- typed into a table by hand: the next preview branch gets them, and anybody
-- reading the history can see when each was taken and why.

-- ===========================================================================
-- 1. What a sales model costs
-- ===========================================================================
--
-- The digitisation sheet records what was sold, not what it cost. That is not
-- an omission: the price belongs to the sales model, and the same model is the
-- same price across every partner running it. The real file carries a "Sales
-- Model" column and no amount column at all.
--
-- So the importer prices a row from its model when the row has no amount of
-- its own. An amount IN the file always wins; this only fills a blank.
--
-- Priced today:
--   Amina Model          42,000
--   Hakimi Sales Model   56,975
--   Hakimi Partner       56,975   (the file spells it this way)
--   Partner Sales        56,975   (same figure, given as such)
--
-- The two spellings of Hakimi are both here on purpose. The file in hand says
-- "Hakimi Partner" and the price was given for "Hakimi Sales Model"; carrying
-- both costs a line and means a sheet using either spelling prices correctly,
-- rather than a whole model going unpriced over a word.
--
-- Adding a model here is data entry. Matching is case-insensitive and ignores
-- surrounding space, because a column typed by hand across four hundred rows
-- will not be consistent about either.
insert into data_center.workflow_config (key, value, description)
values (
  'import.model_amounts',
  '{"Amina Model": 42000, "Hakimi Partner": 56975, "Hakimi Sales Model": 56975, "Partner Sales": 56975}'::jsonb,
  'What one stove costs under each sales model, used to price an imported row whose sheet has no amount column. An amount in the file always wins. A model absent from here refuses its rows with a reason pointing at this setting.'
)
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

-- ===========================================================================
-- 2. LGA is recorded, not demanded
-- ===========================================================================
--
-- The digitisation sheet is typed from a paper receipt and the LGA is usually
-- not on it. On the file in hand every one of 983 rows is blank, because the
-- only "Local Govt Area" column belongs to the CALL CENTRE half of the sheet,
-- where it is confirmed with the end user on the phone.
--
-- Refusing 983 good rows for a field the digitiser was never given, which the
-- call pass is about to supply, is a check costing more than it catches. The
-- column stays on the sheet and is still recorded whenever it is filled.
--
-- State is untouched and still required: it is on the receipt, it is on the
-- sheet, and it is what the scorecards cut by.
--
-- Kept in step with `REQUIRED_FIELDS` and `normalizeRow` in the same commit.
-- The module's rules are explicit that the three must agree, because a sheet
-- blessed by one and refused row by row by another is the exact silent failure
-- the inspect step exists to prevent.
update data_center.workflow_config
   set value = (
     select jsonb_agg(
       case when col ->> 'field' = 'lga' then col - 'required' else col end
       order by ord
     )
     from jsonb_array_elements(value) with ordinality as t(col, ord)
   )
 where key = 'digitisation.sheet_columns'
   and exists (
     select 1 from jsonb_array_elements(value) c
      where c ->> 'field' = 'lga' and (c ->> 'required')::boolean is true
   );

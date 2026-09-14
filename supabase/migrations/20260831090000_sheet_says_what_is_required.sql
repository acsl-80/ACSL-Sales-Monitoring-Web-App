-- The sheet tells the digitiser what is actually required.
--
-- A NEW migration rather than an edit to 20260830090000, deliberately. That one
-- has been applied, and an applied migration does not re-run: editing it would
-- change the file, pass review, and do nothing. That was learned the expensive
-- way on a preview branch while it was still unmerged, which is the only reason
-- it was caught.
--
-- WHAT IS WRONG
--
-- 20260830090000 took `required` off the LGA and left `amount` and
-- `fullAddress` marked. The importer stopped demanding both in the same commit:
-- normalizeRow records an address and never refuses for it, REQUIRED_FIELDS
-- dropped both, and an amount now comes from the row's sales model when the
-- sheet has none.
--
-- So the sheet has been printing "Required." beside two columns nothing
-- requires, and a star on their headers. That is a false instruction to the
-- person typing four hundred receipts, and it is the drift the module's rules
-- name: the sheet spec, REQUIRED_FIELDS and normalizeRow have to agree, or one
-- of them is lying to somebody.
--
-- WHAT EACH SHOULD SAY
--
-- The address is simply not required, and the help says what it is for so
-- somebody with the information still writes it down.
--
-- The amount is CONDITIONALLY required: a row needs one, but it comes from the
-- sales model when the cell is blank. Marking it required would be wrong and so
-- would marking it optional in silence, so the star comes off and the help says
-- where the number comes from.
update data_center.workflow_config
   set value = (
     select jsonb_agg(
       case
         when col ->> 'field' = 'fullAddress' then
           (col - 'required') || jsonb_build_object(
             'help',
             'Where the buyer lives, in enough detail for a field agent to find the house. Leave it blank if the receipt does not say; the call centre collects it.'
           )
         when col ->> 'field' = 'amount' then
           (col - 'required') || jsonb_build_object(
             'help',
             'What the buyer paid. Leave it blank and the price for this row''s sales model is used. A number typed here always wins.'
           )
         else col
       end
       order by ord
     )
     from jsonb_array_elements(value) with ordinality as t(col, ord)
   )
 where key = 'digitisation.sheet_columns'
   and exists (
     select 1 from jsonb_array_elements(value) c
      where c ->> 'field' in ('fullAddress', 'amount')
        and (c ->> 'required')::boolean is true
   );

-- The digitalisation sheet says what the paper User Agreement says.
--
-- The sheet's headings were written by hand, before the dictionary existed, so
-- a typist read "User First Name" on a screen while the receipt in their hand
-- said "First name", and "Sale Amount" where the receipt says "Total Amount
-- (full stove price)". Every heading a person reads is now the dictionary's
-- label for that column's field, so the sheet, the form, the table and the
-- paper all use one vocabulary.
--
-- NOTHING BUT THE WORDS
--
-- Only the "header" property moves. field, required, locked, type, options and
-- help are carried through untouched, because they are the contract between
-- this sheet and its importer and none of them changes here. The columns whose
-- field is not on the agreement keep their headings: Transaction ID names the
-- transfer, Sales Rep and Transfer Date come from the consignment.
--
-- OLD FILES STILL IMPORT
--
-- HEADER_ALIASES in data-center-import carries every new heading beside the old
-- one, so a sheet downloaded last week and a sheet downloaded today both map
-- without the operator meeting the column mapper. REQUIRED_FIELDS and
-- normalizeRow are untouched: what a row must carry has not changed.
--
-- A NEW migration rather than an edit to an applied one, for the reason
-- 20260831090000 wrote down: an applied migration does not re-run.

update data_center.workflow_config w
   set value = (
         select jsonb_agg(
                  case
                    when m.header is null then col
                    else col || jsonb_build_object('header', m.header)
                  end
                  order by ord
                )
           from jsonb_array_elements(w.value) with ordinality as t(col, ord)
           left join (values
             ('stoveSerialNo',       'Serial number'),
             ('partnerName',         'Sales partner'),
             ('firstName',           'First name'),
             ('lastName',            'Surname'),
             ('aka',                 'Also known as'),
             ('phone',               'Telephone number'),
             ('otherPhone',          'Other telephone number'),
             ('contactPerson',       'Buyer Name'),
             ('contactPhone',        'Contact phone'),
             ('salesDate',           'Sales date'),
             ('amount',              'Total Amount (full stove price)'),
             ('amountReceived',      'Amount paid (first installment)'),
             ('state',               'State'),
             ('lga',                 'LGA'),
             ('fullAddress',         'Address'),
             ('potQuantity',         'Pots quantity'),
             ('heatRetentionDevice', 'Wonderbox'),
             ('previousStoveType',   'Baseline stove'),
             ('previousStoveOther',  'Baseline stove, other'),
             ('mealsPerDay',         'Meals per day'),
             ('cookingFuelSource',   'Fuel source'),
             ('cookingLocation',     'Cooking location'),
             ('termsAccepted',       'CPA (Terms and Conditions)')
           ) as m(field, header) on m.field = col ->> 'field'
       )
 where w.key = 'digitisation.sheet_columns';

-- What it should say afterwards, to paste back:
--
--   select c.ord, c.col ->> 'field' as field, c.col ->> 'header' as header
--     from data_center.workflow_config,
--          lateral jsonb_array_elements(value) with ordinality as c(col, ord)
--    where key = 'digitisation.sheet_columns'
--    order by c.ord;

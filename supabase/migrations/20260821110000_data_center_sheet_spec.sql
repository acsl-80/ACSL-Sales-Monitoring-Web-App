-- ===========================================================================
-- The digitalisation sheet, as data
--
-- The sheet handed to digitisers had its columns written into the component
-- that built it, which meant the file people type into and the form people
-- type into could drift apart with nobody noticing until a column stopped
-- importing. It also meant a CSV: no dropdowns, no guidance, and a typist
-- inventing "Charcoal stove" where the form says "charcoal".
--
-- The columns live here instead. Which ones the sheet carries, which are
-- required, and where each dropdown's choices come from - a literal list for
-- the ones the form hard-codes, an option_lists key for the ones the registry
-- already owns. Adding a column to the sheet is now data entry, exactly as
-- adding a question to the call form is.
--
-- `field` is the name the import understands; `header` is what a person reads.
-- Both are needed: the header is chosen for the typist and the field is the
-- contract, and conflating them is how renaming a column for clarity quietly
-- breaks an import.
--
-- Rollback:
--   delete from data_center.workflow_config
--    where key in ('digitisation.sheet_columns', 'digitisation.sheet_format');
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('digitisation.sheet_format', '"xlsx"'::jsonb,
   'What the sheet downloads as. "xlsx" carries dropdowns and guidance; "csv" is plain text for anything that cannot open a workbook.'),

  ('digitisation.sheet_columns', $json$[
    {"field":"stoveSerialNo","header":"Stove ID","locked":true,
     "help":"Filled in from the transfer. Do not change it: it is what ties this sale to a partner."},
    {"field":"transactionId","header":"Transaction ID","locked":true,
     "help":"The transfer this stove went out on. Filled in already."},
    {"field":"partnerName","header":"Partner","locked":true},
    {"field":"salesRep","header":"Sales Rep","locked":true},
    {"field":"transferDate","header":"Transfer Date","locked":true},

    {"field":"firstName","header":"User First Name","required":true},
    {"field":"lastName","header":"User Last Name","required":true},
    {"field":"aka","header":"AKA"},
    {"field":"phone","header":"Primary Phone Number","required":true,
     "help":"Format this column as Text first, or the spreadsheet drops the leading zero."},
    {"field":"otherPhone","header":"Alternative Phone Number"},
    {"field":"contactPerson","header":"Contact Person",
     "help":"Leave empty if the buyer is the contact."},
    {"field":"contactPhone","header":"Contact Phone"},

    {"field":"salesDate","header":"Sales Date","required":true,"type":"date",
     "help":"As 2026-07-14."},
    {"field":"amount","header":"Sale Amount","required":true,"type":"number",
     "help":"Digits only. No naira sign, no commas."},
    {"field":"amountReceived","header":"Amount Received","type":"number",
     "help":"Leave empty if nothing has been paid."},

    {"field":"state","header":"State","required":true},
    {"field":"lga","header":"LGA","required":true},
    {"field":"fullAddress","header":"User Residential Address","required":true},

    {"field":"potQuantity","header":"Pots Quantity","type":"list",
     "options":["0","1","2"]},
    {"field":"heatRetentionDevice","header":"Wonderbox","type":"list",
     "options":["Yes","No"],
     "help":"Whether a heat retention device was included."},
    {"field":"previousStoveType","header":"Previous Stove Type","type":"list",
     "options":["charcoal","wood_stove","other"],
     "help":"Exactly one of these three. Use other and fill the next column to describe it."},
    {"field":"previousStoveOther","header":"Previous Stove (other)"},
    {"field":"mealsPerDay","header":"Meals Per Day"},
    {"field":"cookingFuelSource","header":"Fuel Source"},
    {"field":"cookingLocation","header":"Cooking Location"},

    {"field":"termsAccepted","header":"All Terms Agreed","type":"list",
     "options":["Yes","No"],
     "help":"Yes means the buyer signed the paper agreement and accepted all six terms."}
  ]$json$::jsonb,
   'The columns the digitalisation sheet carries. field is what the import understands, header is what the typist reads, type list gives a dropdown. Edit here to change the sheet without a release.')
on conflict (key) do nothing;

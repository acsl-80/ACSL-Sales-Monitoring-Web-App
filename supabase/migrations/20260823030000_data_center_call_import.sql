-- ===========================================================================
-- The call-centre sheet, as data
--
-- Agents have kept their own spreadsheets since before this module existed.
-- One week of the workbook holds 359 stove IDs. Until now there was no way to
-- get any of that in: `import_batches.source` has permitted 'call_center'
-- since the first migration and nothing has ever written it, so every call
-- record had to be typed one at a time through the form.
--
-- This is the column spec for a sheet that goes the other way from the
-- digitalisation one. That sheet creates sales. This one MATCHES them: a row
-- whose stove ID finds no sale is an exception for a person, never a new sale,
-- because a call cannot bring a stove into existence.
--
-- WHY THE QUESTIONS ARE NOT LISTED HERE
--
-- The 13 call questions live in `field_defs` and are already editable in
-- Settings. Restating them here would be a second copy that drifts the first
-- time somebody retires a question, so the sheet builder appends the active
-- ones instead. Add a question in Settings and it appears in the sheet with no
-- release, which is the same promise the call form already makes.
--
-- `field` is the name the import understands; `header` is what a person reads.
-- `optionList` points at a registry list so the dropdown and the call form can
-- never offer different choices.
--
-- Rollback:
--   delete from data_center.workflow_config
--    where key in ('call_centre.sheet_columns', 'call_centre.sheet_format');
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('call_centre.sheet_format', '"xlsx"'::jsonb,
   'What the call sheet downloads as. "xlsx" carries dropdowns and guidance; "csv" is plain text for anything that cannot open a workbook.'),

  ('call_centre.sheet_columns', $json$[
    {"field":"stoveSerialNo","header":"Stove ID","locked":true,"required":true,
     "help":"Filled in already. This is what ties the call to a record, so do not change it."},
    {"field":"endUserName","header":"Buyer On Record","locked":true},
    {"field":"phone","header":"Phone On Record","locked":true},
    {"field":"partnerName","header":"Partner","locked":true},
    {"field":"salesDate","header":"Sale Date","locked":true},

    {"field":"callDate1","header":"Call 1 Date","type":"date",
     "help":"As 2026-07-14. Leave empty if the call was not made."},
    {"field":"callDate2","header":"Call 2 Date","type":"date"},
    {"field":"callDate3","header":"Call 3 Date","type":"date"},

    {"field":"callOutcome","header":"Call Outcome","type":"list","optionList":"call_outcome",
     "help":"What happened on the last call."},
    {"field":"callAgent","header":"Agent","type":"list","optionList":"agent_name"},
    {"field":"answeredBy","header":"Answered By","type":"list","optionList":"answered_by"},

    {"field":"verification","header":"Verification","type":"list",
     "choices":[
       {"value":"fully_verified","label":"Fully verified"},
       {"value":"partially_verified","label":"Partially verified"},
       {"value":"unreachable","label":"Unreachable"},
       {"value":"not_verified","label":"Not verified"}],
     "help":"Leave empty and the record stays not verified, which is also what an untouched record reads as."},

    {"field":"correctedName","header":"Corrected Name"},
    {"field":"correctedPhone","header":"Corrected Phone",
     "help":"Format this column as Text first, or the spreadsheet drops the leading zero."},
    {"field":"correctedAltPhone","header":"Corrected Alternative Phone"},
    {"field":"correctedAddress","header":"Corrected Address"},
    {"field":"correctedState","header":"Corrected State"},
    {"field":"correctedLga","header":"Corrected LGA"},
    {"field":"ward","header":"Ward"},
    {"field":"landmark","header":"Landmark"},
    {"field":"statedSerial","header":"Stove ID As Stated",
     "help":"What the buyer read out, if it differs from the Stove ID column."},

    {"field":"comments","header":"Other Comments"}
  ]$json$::jsonb,
   'The columns the call-centre sheet carries, on top of the active questions from field_defs which the builder appends. field is what the import understands, header is what the agent reads, optionList points the dropdown at a registry list. Edit here to change the sheet without a release.'),

  ('call_import.require_match', 'true'::jsonb,
   'Whether a call row must find exactly one live sale for its stove ID. True is the only sane setting today and it is here so the rule is visible beside the others rather than buried in code. A row that matches nothing becomes an exception, never a new sale.')
on conflict (key) do nothing;

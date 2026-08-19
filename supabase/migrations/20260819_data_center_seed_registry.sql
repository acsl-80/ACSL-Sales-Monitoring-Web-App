-- Data Center: seed the registry from the call centre workbook's Key tab.
--
-- Source: "Sales Verification CALL CENTER REPORT_July_4th_Week.xlsx", Key tab.
-- Its own instruction is the design brief for this table: "Edit a list there and
-- the dropdown updates automatically." Everything below is data, so changing a
-- wording is an edit rather than a release.
--
-- `value` is a stable slug and `label` is the display text. Records reference
-- option_values by id, so a label can be corrected without rewriting history.
--
-- Idempotent: safe to re-run.

-- ===========================================================================
-- Option lists
-- ===========================================================================

insert into data_center.option_lists (key, label, description) values
  ('agent_name',            'Agent Name',                          'Call centre agents. Migrates to profiles once the call-centre role exists.'),
  ('call_outcome',          'Call Outcome',                        'What happened on the phone. Distinct from the verification conclusion.'),
  ('first_save80_cookstove','First Save80 Cookstove',              'Double-counting check.'),
  ('stove_subsidy',         'Stove Subsidy',                       'Whether the user can explain why the stove was subsidised.'),
  ('baseline_stove',        'Baseline Stove',                      'What the household cooked on before Save80.'),
  ('carbon_credit_waiver',  'Carbon Credit Waiver and Monitoring', 'Awareness of the waiver and of monitoring visits.'),
  ('stove_usage',           'Stove Usage',                         'What the household cooks on now.'),
  ('sales_model',           'Sales Model',                         'Mirrors public.payment_models. Kept as a list for import matching.'),
  ('bdm',                   'BDMs',                                'Business development managers and sales officers.'),
  ('data_upload_team',      'Data Upload Team',                    'Who digitalized the record.'),
  ('yes_no',                'Yes / No',                            'Shared list for the binary survey questions.')
on conflict (key) do update
  set label = excluded.label, description = excluded.description;


-- ===========================================================================
-- Option values
-- ===========================================================================

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('agent_name','happy','Happy',1),
  ('agent_name','hanifa','Hanifa',2),
  ('agent_name','princess','Princess',3),
  ('agent_name','rose','Rose',4),
  ('agent_name','dora','Dora',5),
  ('agent_name','kharriyah','Kharriyah',6),
  ('agent_name','rahina','Rahina',7),

  -- The nine from the Key tab. RESPONDED, REPONDED and NO PHONE NUMBER appear
  -- in the July data but are absent from the Key tab: they are free text typed
  -- into a column meant to be constrained, and they are exactly what this list
  -- exists to prevent. They are NOT seeded. Import maps them during migration.
  ('call_outcome','unreachable','Unreachable',1),
  ('call_outcome','phone_unanswered','Phone unanswered',2),
  ('call_outcome','no_save80_stove','No Save80 Stove',3),
  ('call_outcome','wrong_number','Wrong number',4),
  ('call_outcome','callback_requested','Customer requested for a call back later',5),
  ('call_outcome','customer_hung_up','Customer hung up',6),
  ('call_outcome','agent_attention_needed','Agent attention needed',7),
  ('call_outcome','serial_number_mismatch','Serial Number Mismatch',8),
  ('call_outcome','multiple_stove','Multiple Stove',9),

  ('first_save80_cookstove','only_stove','Yes, It''s my only save80 cookstove',1),
  ('first_save80_cookstove','replacing','No, I''m replacing my save80 cookstove',2),
  ('first_save80_cookstove','has_others','No, I''ve other working save80 cookstove',3),

  ('stove_subsidy','fully_connects','User can fully connect this to carbon project including efforts to reduce emissions and deforestation',1),
  ('stove_subsidy','partially_explains','User can partially explain',2),
  ('stove_subsidy','does_not_understand','User does not understand the question',3),

  ('baseline_stove','traditional_charcoal','Traditional Charcoal',1),
  ('baseline_stove','three_stone_firewood','3 Stone Firewood',2),
  ('baseline_stove','traditional_firewood_metal','Traditional Firewood (Metal)',3),
  ('baseline_stove','lpg','LPG (Gas)',4),
  ('baseline_stove','electric_hotplate','Electric (Hot plate)',5),

  ('carbon_credit_waiver','understands_comfortable','User fully understands the waiver and is comfortable with frequent calls and visits.',1),
  ('carbon_credit_waiver','understands_not_comfortable','User fully understands the waiver and is not comfortable with frequent calls and visits.',2),
  ('carbon_credit_waiver','not_aware_of_both','User is not aware of both',3),
  ('carbon_credit_waiver','does_not_understand','User does not understand the question',4),

  ('stove_usage','traditional_charcoal','Traditional Charcoal',1),
  ('stove_usage','three_stone_firewood','3 Stone Firewood',2),
  ('stove_usage','traditional_firewood_metal','Traditional Firewood (Metal)',3),
  ('stove_usage','lpg','LPG (Gas)',4),
  ('stove_usage','electric_hotplate','Electric (Hot plate)',5),
  ('stove_usage','save80','Save80',6),

  ('sales_model','hakimi_partner','Hakimi Partner',1),
  ('sales_model','amina_model','Amina Model',2),
  ('sales_model','direct_community','Direct Community',3),
  ('sales_model','partner_sales','Partner Sales',4),

  ('bdm','olatunji','Olatunji',1),
  ('bdm','otaz','Otaz',2),
  ('bdm','yusuf','Yusuf',3),
  ('bdm','abdulrasheed','Abdulrasheed',4),
  ('bdm','adaeze','Adaeze',5),
  ('bdm','kamal','Kamal',6),
  ('bdm','ladi','Ladi',7),
  ('bdm','lucky','Lucky',8),
  ('bdm','onome','Onome',9),
  ('bdm','femi','Femi',10),
  ('bdm','ejiro','Ejiro',11),
  ('bdm','nkechi','Nkechi',12),
  ('bdm','abiodun','Abiodun',13),
  ('bdm','bello_shulli','Bello Shulli',14),
  ('bdm','nelson','Nelson',15),

  ('data_upload_team','ummi','Ummi',1),
  ('data_upload_team','jibola','Jibola',2),
  ('data_upload_team','happy','Happy',3),
  ('data_upload_team','hanifa','Hanifa',4),
  ('data_upload_team','princess','Princess',5),
  ('data_upload_team','rose','Rose',6),
  ('data_upload_team','dora','Dora',7),
  ('data_upload_team','kharriyah','Kharriyah',8),
  ('data_upload_team','rahina','Rahina',9),
  ('data_upload_team','peace','Peace',10),

  ('yes_no','yes','Yes',1),
  ('yes_no','no','No',2)
on conflict (list_key, value) do update
  set label = excluded.label, sort_order = excluded.sort_order;


-- ===========================================================================
-- Field definitions
--
-- The questionnaire, columns AD to AO of the workbook. All start in
-- call_records.answers; each graduates to a real column via `storage` once it
-- earns aggregation.
-- ===========================================================================

insert into data_center.field_defs
  (key, label, section, input_type, option_list_key, sort_order, is_required, help_text) values
  ('double_counting',      'Double Counting',
   'verification','select','first_save80_cookstove',1,false,
   'Guards against one household being counted twice.'),

  ('knows_sales_agent',    'Do you have the name and contact of the agent who sold the stove to you',
   'verification','select','yes_no',2,false,null),

  ('purchase_price',       'How much did you purchase your Save80 Cookstove?',
   'verification','number',null,3,false,
   'Compare against sales.amount to surface pricing discrepancies.'),

  ('subsidy_explanation',  'Would you describe why save80 stove was sold at a subsidized price?',
   'carbon','select','stove_subsidy',4,false,null),

  ('waiver_awareness',     'Carbon Credit Waiver and Usage monitoring visit Awareness',
   'carbon','select','carbon_credit_waiver',5,false,null),

  ('baseline_stove',       'What stove were you using in your household before purchasing Save80?',
   'cooking','select','baseline_stove',6,false,
   'The baseline for emission reduction. Compare against sales.previous_stove_type.'),

  ('current_stove',        'Which of the following stoves do you currently use for most of your meals?',
   'cooking','select','stove_usage',7,false,
   'If this is not Save80, the stove is not displacing the baseline.'),

  ('uses_per_day',         'How many times do you use Save80 cookstove per day?',
   'cooking','text',null,8,false,null),

  ('aware_stop_traditional','Is the User aware that they should stop using their traditional cookstove once they purchase Save80 cookstove?',
   'cooking','select','yes_no',9,false,null),

  ('warranty_explained',   'Did the sales agent explain how long is the warranty period?',
   'service','select','yes_no',10,false,null),

  ('contact_explained',    'Did the sales agent explain how to contact ACSL incase of any concerns with the Save80 cookstove?',
   'service','select','yes_no',11,false,null),

  ('other_concerns',       'Might you have any other issue/concern/query that you would like to seek clarifications on?',
   'service','text',null,12,false,null)
on conflict (key) do update
  set label           = excluded.label,
      section         = excluded.section,
      input_type      = excluded.input_type,
      option_list_key = excluded.option_list_key,
      sort_order      = excluded.sort_order,
      help_text       = excluded.help_text;


-- ===========================================================================
-- Workflow configuration
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('callback_limit', '3'::jsonb,
   'Maximum call attempts before a record leaves the active queue. Matches the workbook''s Call_date_1/2/3.'),

  ('import_serial_must_match_stock', 'true'::jsonb,
   'An imported receipt must match a stove_id in public.stove_ids_base. Roughly 8% of a real workbook does not, and those route to the exceptions queue rather than being refused.'),

  -- public.calculate_sale_status() still demands the stove photo and the
  -- agreement document, both of which the Sell Stove form made optional. The
  -- result is that 30 of 38 production rows read `incomplete`, and a dashboard
  -- counting completed sales would report 1 of 15. The module therefore carries
  -- its own definition rather than trusting sales.status.
  ('completeness_required_fields',
   '["transaction_id","stove_serial_no","end_user_name","phone","amount","address_id","signature"]'::jsonb,
   'The module''s own definition of a complete sale. Deliberately excludes stove_image_id and agreement_image_id, which the form no longer requires.'),

  ('verification_states',
   '["fully_verified","partially_verified","doubtful_verification","not_verified"]'::jsonb,
   'Documentation of the four states. The authoritative constraint is the CHECK on call_records.verification_outcome.')
on conflict (key) do update
  set value = excluded.value, description = excluded.description, updated_at = now();

-- The sheet's model names map to the sales app's own payment models.
--
-- `import.model_amounts` was a hand-kept copy of prices that
-- `public.payment_models` already owns canonically ("Amina Sales Model"
-- 42,000; "Hakimi Sales Model" 56,975 - live-checked against production
-- before this migration was written). A copied price is a second source of
-- truth: change the model in the sales app and the import quietly keeps
-- charging the old number.
--
-- The config now carries only what IS import-specific knowledge: what the
-- sheets call a model. The price - and now the model's id, which the commit
-- sends through create-sale's installment door so "paid" can be what was
-- actually received rather than being coerced to the full amount - comes from
-- the model row itself.
--
-- `import.model_amounts` is left in place, unread, as history. Deleting a
-- config row a rollback might want back buys nothing.
insert into data_center.workflow_config (key, value, description) values
  ('import.model_map',
   '{"Amina Model": "Amina Sales Model",
     "Amina Sales Model": "Amina Sales Model",
     "Hakimi Sales Model": "Hakimi Sales Model",
     "Hakimi Partner": "Hakimi Sales Model",
     "Partner Sales": "Hakimi Sales Model"}'::jsonb,
   'What the digitisation sheets call each sales model, mapped to the exact '
   'name in public.payment_models. The price and the model id come from the '
   'model row itself - never from config. Add a spelling here when a sheet '
   'convention appears; add a model in the sales app, not here.')
on conflict (key) do nothing;

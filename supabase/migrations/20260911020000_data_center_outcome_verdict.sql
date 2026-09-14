-- Phase 28, S2: the outcome of a call decides the verdict, as a setting (D42).
--
-- Save call writes the attempt and the record in one transaction. This map
-- says which call outcomes conclude a record on their own: a verified call
-- concludes it fully, a partly verified call partly. Nothing else does.
-- Unreachable as a call outcome never sets the verdict by itself: unreachable
-- is the agent's judgement after the callback limit and it is terminal for
-- the pool, so one unanswered call must not conclude a record. The pills on
-- the form stay, and an explicit pill beats the map.
insert into data_center.workflow_config (key, value, description)
values (
  'call_centre.outcome_verdict',
  '{"verified": "fully_verified", "partially_verified": "partially_verified"}'::jsonb,
  'Call outcome value to verification verdict, applied by Save call when the agent picked no verdict themselves (D42). Only the four verdict values are honoured; anything else is ignored with a warning.'
)
on conflict (key) do nothing;

select key, value from data_center.workflow_config where key = 'call_centre.outcome_verdict';

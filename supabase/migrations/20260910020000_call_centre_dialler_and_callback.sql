-- Phase 26, C4: the agent's surface, on the call form that exists.
--
-- Two additions, both additive, both in the module's own schema.
--
-- 1. The call app's name is a setting, never a literal (D36). The agents dial
--    in a separate VoIP application and record the outcome here; every copy
--    button's hint names the app, and a change of vendor is an edit in
--    Settings, not a release.
-- 2. A callback carries a time. Until now "call back later" was an outcome
--    with no hour attached; the agent's queue could not put it above the
--    rest at the right moment. One nullable column on the call attempt,
--    written when the outcome is a callback and the agent picks a time.

insert into data_center.workflow_config (key, value, description) values
  ('call_centre.dialler_name', '"Call Savvy"'::jsonb,
   'The name of the application the agents make calls in. Every copy button''s hint names it. Change it here when the vendor changes.')
on conflict (key) do nothing;

alter table data_center.call_attempts
  add column if not exists callback_at timestamptz;

comment on column data_center.call_attempts.callback_at is
  'When the buyer asked to be rung again, if the outcome was a callback. Null otherwise. Added Phase 26, C4.';

-- Readback: the setting, and the column present.
select (select value #>> '{}' from data_center.workflow_config where key = 'call_centre.dialler_name') as dialler_name,
       (select count(*) from information_schema.columns
         where table_schema = 'data_center' and table_name = 'call_attempts' and column_name = 'callback_at') as callback_column;

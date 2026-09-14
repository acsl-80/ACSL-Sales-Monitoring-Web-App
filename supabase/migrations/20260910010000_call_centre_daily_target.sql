-- Phase 26, C2: the shift board's pace.
--
-- One number, in configuration: how many calls a day the call centre expects
-- of one agent. The board's Called cell reads "12 of 30" against it and turns
-- amber when the day's pace will miss it. Zero means no target is set and the
-- cell shows the count alone. Additive; editable in Settings under Variables
-- like every other key here.

insert into data_center.workflow_config (key, value, description) values
  ('call_centre.daily_target', '0'::jsonb,
   'Calls per agent per day the board measures pace against. 0 means no target: the board shows the count alone.')
on conflict (key) do nothing;

-- Readback: one row, value 0 on a fresh apply.
select key, value from data_center.workflow_config where key = 'call_centre.daily_target';

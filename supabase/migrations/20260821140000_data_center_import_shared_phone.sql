-- ===========================================================================
-- A shared phone is a warning, not a refusal - and the digitiser has to see it
-- before they commit, not after.
--
-- Today a sheet carrying the same number twice validates clean and then fails
-- at commit, one row at a time, with create-sale's refusal. That is the worst
-- ordering: the work is done, the operator has moved on, and the reason
-- arrives detached from the rows that caused it.
--
-- So validation looks for it and marks the rows. The status stays `valid`,
-- because a shared number is allowed on this path - one household, one number,
-- two stoves. What changes is that the row arrives at the confirm step wearing
-- an amber flag naming the stoves already on that number, so the person who
-- can tell a family from a typo is looking at both before anything commits.
-- ===========================================================================

alter table data_center.import_rows
  add column if not exists shared_phone_with text[];

comment on column data_center.import_rows.shared_phone_with is
  'Stove IDs already recorded against this row''s phone number, whether from a live sale or from another row of the same file. Non-empty means show the row amber; it never blocks a commit.';

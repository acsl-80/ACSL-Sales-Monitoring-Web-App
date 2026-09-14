-- ===========================================================================
-- Say what to do about it, not only what is wrong
--
-- A rejected row carried a reason and nothing else: "Phone number "8031234567"
-- is not a valid Nigerian number". True, and useless to the person holding the
-- receipt, because that number IS the buyer's number and the only thing wrong
-- with it is that Excel removed the leading zero when it decided the column
-- was numeric.
--
-- The reader of a rejection file is a digitiser with four hundred more rows to
-- type. A reason without a fix is a row that gets skipped rather than
-- corrected, and skipped rows are how a backlog stops shrinking.
--
-- Kept as its own column rather than appended to the reason so the two can be
-- shown differently: reasons group (three hundred rows, one problem), and a
-- hint is the same sentence for every row in a group.
--
-- Rollback:
--   alter table data_center.import_rows drop column rejection_hint;
-- ===========================================================================

alter table data_center.import_rows
  add column if not exists rejection_hint text;

comment on column data_center.import_rows.rejection_hint is
  'What the person fixing this row should actually do. Paired with rejection_reason, which says only what is wrong.';

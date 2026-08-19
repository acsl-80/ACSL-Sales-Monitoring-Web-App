ALTER TABLE stove_transfer_history
  ADD COLUMN IF NOT EXISTS customer    text,
  ADD COLUMN IF NOT EXISTS downloaded_by text,
  ADD COLUMN IF NOT EXISTS sales_rep   text;

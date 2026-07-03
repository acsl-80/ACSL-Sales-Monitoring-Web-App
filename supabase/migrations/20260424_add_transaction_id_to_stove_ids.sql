-- Add sales_reference (ERP transaction reference) to stove_ids table

ALTER TABLE stove_ids
  ADD COLUMN IF NOT EXISTS sales_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_stove_ids_sales_reference ON stove_ids(sales_reference);

-- ============================================================================
-- apply_stove_field_backfill
-- Bulk-correct stove_ids_base.{sales_reference, transfer_sales_date, factory}
-- from authoritative ERP data (passed in as a JSON array of flat rows).
--
-- Writes to stove_ids_base (the real table) so it can also fix rows that are
-- currently HIDDEN by the year-cutoff view.
--
-- Modes:
--   dry_run = true  -> changes nothing, returns the counts of what WOULD change
--   dry_run = false -> performs the update
--   do_overwrite = false -> only fills NULLs
--   do_overwrite = true  -> also overwrites existing values that differ
--
-- Input shape (rows): [{ "stove_id": "..", "sales_reference": "..",
--                        "sales_date": "YYYY-MM-DD", "factory": ".." }, ...]
-- Any field may be omitted/null; null fields are never written.
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_stove_field_backfill(
  rows         jsonb,
  do_overwrite boolean DEFAULT false,
  dry_run      boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
BEGIN
  CREATE TEMP TABLE _bf (
    stove_id            text,
    sales_reference     text,
    transfer_sales_date date,
    factory             text
  ) ON COMMIT DROP;

  -- Parse incoming rows; tolerate bad dates (left NULL rather than erroring).
  INSERT INTO _bf
  SELECT
    x.stove_id,
    nullif(btrim(x.sales_reference), ''),
    CASE WHEN btrim(x.sales_date) ~ '^\d{4}-\d{2}-\d{2}'
         THEN btrim(x.sales_date)::date ELSE NULL END,
    nullif(btrim(x.factory), '')
  FROM jsonb_to_recordset(rows)
    AS x(stove_id text, sales_reference text, sales_date text, factory text)
  WHERE nullif(btrim(x.stove_id), '') IS NOT NULL;

  -- Preview counts (matched rows in base, and per-field fill/overwrite).
  WITH j AS (
    SELECT b.*, s.stove_id AS matched,
           s.sales_reference     AS cur_ref,
           s.transfer_sales_date AS cur_date,
           s.factory             AS cur_factory
    FROM _bf b
    LEFT JOIN stove_ids_base s ON s.stove_id = b.stove_id
  )
  SELECT jsonb_build_object(
    'input_rows',          (SELECT count(*) FROM _bf),
    'matched',             count(*) FILTER (WHERE matched IS NOT NULL),
    'not_found_in_app',    count(*) FILTER (WHERE matched IS NULL),
    'sales_reference', jsonb_build_object(
      'would_fill',      count(*) FILTER (WHERE matched IS NOT NULL AND sales_reference IS NOT NULL AND cur_ref IS NULL),
      'would_overwrite', count(*) FILTER (WHERE matched IS NOT NULL AND sales_reference IS NOT NULL AND cur_ref IS NOT NULL AND cur_ref IS DISTINCT FROM sales_reference)
    ),
    'transfer_sales_date', jsonb_build_object(
      'would_fill',      count(*) FILTER (WHERE matched IS NOT NULL AND transfer_sales_date IS NOT NULL AND cur_date IS NULL),
      'would_overwrite', count(*) FILTER (WHERE matched IS NOT NULL AND transfer_sales_date IS NOT NULL AND cur_date IS NOT NULL AND cur_date IS DISTINCT FROM transfer_sales_date)
    ),
    'factory', jsonb_build_object(
      'would_fill',      count(*) FILTER (WHERE matched IS NOT NULL AND factory IS NOT NULL AND cur_factory IS NULL),
      'would_overwrite', count(*) FILTER (WHERE matched IS NOT NULL AND factory IS NOT NULL AND cur_factory IS NOT NULL AND cur_factory IS DISTINCT FROM factory)
    )
  ) INTO result
  FROM j;

  IF NOT dry_run THEN
    UPDATE stove_ids_base s
    SET
      sales_reference = CASE
        WHEN b.sales_reference IS NOT NULL AND (do_overwrite OR s.sales_reference IS NULL)
        THEN b.sales_reference ELSE s.sales_reference END,
      transfer_sales_date = CASE
        WHEN b.transfer_sales_date IS NOT NULL AND (do_overwrite OR s.transfer_sales_date IS NULL)
        THEN b.transfer_sales_date ELSE s.transfer_sales_date END,
      factory = CASE
        WHEN b.factory IS NOT NULL AND (do_overwrite OR s.factory IS NULL)
        THEN b.factory ELSE s.factory END
    FROM _bf b
    WHERE s.stove_id = b.stove_id;

    result := result || jsonb_build_object('applied', true);
  ELSE
    result := result || jsonb_build_object('applied', false);
  END IF;

  DROP TABLE IF EXISTS _bf;
  RETURN result;
END;
$$;

-- ============================================================================
-- Stove ID year cutoff — hide all stove IDs with a sale BEFORE 2026-01-01,
-- everywhere, for every role (including service_role used by edge functions).
--
-- Mechanism: a denormalized sales_date column on the stove row (so the
-- filtering view can stay single-table and therefore WRITABLE), plus a view
-- named "stove_ids" that replaces the table name so all 22 edge functions and
-- any direct reads transparently see only 2026+ sold stoves and all unsold
-- stock.
--
-- Rows below the cutoff are NOT deleted — only hidden. Fully reversible.
--
-- RUN ONE STEP AT A TIME. Verify after each. The swap (STEP 5) is the only
-- sensitive step; STEP 4 proves embedding works BEFORE you run it.
-- ============================================================================


-- ───────────────────────── STEP 1: add column (safe, additive) ─────────────
ALTER TABLE stove_ids ADD COLUMN IF NOT EXISTS transfer_sales_date date;


-- ───────────────────────── STEP 2: backfill from transfer history ──────────
-- The sale date lives in stove_transfer_history.sales_date, linked to a stove
-- via stove_ids.sales_reference = stove_transfer_history.transaction_id.
-- (sale_id is effectively unused in this DB, so we do NOT use it.)
-- A reference may have several transfer rows (re-sends) — take the latest date.
UPDATE stove_ids s
SET transfer_sales_date = th.sales_date
FROM (
  SELECT transaction_id, max(sales_date) AS sales_date
  FROM stove_transfer_history
  WHERE sales_date IS NOT NULL
  GROUP BY transaction_id
) th
WHERE s.sales_reference = th.transaction_id
  AND s.transfer_sales_date IS DISTINCT FROM th.sales_date;

-- Verify (run separately) — should match the diagnostic: ~8866 to show, ~1105 hidden:
--   SELECT count(*) FILTER (WHERE transfer_sales_date >= '2026-01-01') AS show_dated_2026,
--          count(*) FILTER (WHERE transfer_sales_date <  '2026-01-01') AS hide_pre_2026,
--          count(*) FILTER (WHERE transfer_sales_date IS NULL)         AS show_undatable
--   FROM stove_ids;


-- ───────────────────────── STEP 3: keep it fresh (two triggers) ────────────
-- Two orderings happen in external-sync (stoves can be inserted before OR
-- after their transfer-history row), so we cover both directions.

-- 3a. When a stove gets/changes its sales_reference, look up the date now.
CREATE OR REPLACE FUNCTION sync_transfer_sales_date_on_stove()
RETURNS trigger AS $$
BEGIN
  -- Only derive the date when one wasn't explicitly provided, so authoritative
  -- values (e.g. the ERP backfill) are never overwritten by history lookups.
  IF NEW.sales_reference IS NOT NULL AND NEW.transfer_sales_date IS NULL THEN
    SELECT max(sales_date) INTO NEW.transfer_sales_date
    FROM stove_transfer_history
    WHERE transaction_id = NEW.sales_reference
      AND sales_date IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stove_transfer_sales_date ON stove_ids;
CREATE TRIGGER trg_stove_transfer_sales_date
BEFORE INSERT OR UPDATE OF sales_reference ON stove_ids
FOR EACH ROW EXECUTE FUNCTION sync_transfer_sales_date_on_stove();
-- (Moves automatically with the table when it's renamed in STEP 5.)

-- 3b. When a transfer-history row lands/updates with a date, stamp its stoves.
CREATE OR REPLACE FUNCTION sync_transfer_sales_date_from_history()
RETURNS trigger AS $$
BEGIN
  IF NEW.sales_date IS NOT NULL THEN
    UPDATE stove_ids
       SET transfer_sales_date = NEW.sales_date
     WHERE sales_reference = NEW.transaction_id
       AND transfer_sales_date IS DISTINCT FROM NEW.sales_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_history_transfer_sales_date ON stove_transfer_history;
CREATE TRIGGER trg_history_transfer_sales_date
AFTER INSERT OR UPDATE OF sales_date ON stove_transfer_history
FOR EACH ROW EXECUTE FUNCTION sync_transfer_sales_date_from_history();


-- ───────────────────────── STEP 4: PROVE embedding works (test, reversible) ─
-- Edge functions embed sales (e.g. get-stove-ids: select=...,sales!left(...)).
-- We confirm PostgREST can still embed through a table-backed view BEFORE we
-- rename the real table.
CREATE VIEW stove_ids_embed_test AS SELECT * FROM stove_ids;
GRANT SELECT ON stove_ids_embed_test TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
-- Then in Postman (monitoring project), with apikey + a service_role or
-- super_admin bearer token:
--   GET <PROJECT_URL>/rest/v1/stove_ids_embed_test?select=stove_id,sales!left(sales_date)&limit=1
-- If the response includes a nested "sales" object -> embedding works. Proceed.
-- Cleanup either way:
--   DROP VIEW stove_ids_embed_test;


-- ───────────────────────── STEP 5: THE SWAP (sensitive) ────────────────────
-- Run as one transaction. Instant rollback available (STEP 6).
BEGIN;
  ALTER TABLE stove_ids RENAME TO stove_ids_base;

  CREATE VIEW stove_ids WITH (security_invoker = on) AS
    SELECT * FROM stove_ids_base
    WHERE transfer_sales_date IS NULL              -- undatable (no ref / no date) -> keep visible for now
       OR transfer_sales_date >= '2026-01-01';     -- confirmed 2026+ -> visible; only pre-2026 is hidden
  -- (No WITH CHECK OPTION: external-sync must still be able to insert rows,
  --  including new ones whose transfer_sales_date is briefly NULL.)

  GRANT SELECT, INSERT, UPDATE, DELETE ON stove_ids
    TO anon, authenticated, service_role;
COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify live after this:
--   * monitoring app stove lists show only 2026 sold + current stock
--   * run a real or test external-sync (insert path) -> succeeds
--   * the agents "stove in stock" view loads


-- ───────────────────────── STEP 6: ROLLBACK (only if needed) ───────────────
-- DROP VIEW IF EXISTS stove_ids;
-- ALTER TABLE stove_ids_base RENAME TO stove_ids;
-- NOTIFY pgrst, 'reload schema';
-- (The sales_date column + trigger are harmless; leave them or drop them.)

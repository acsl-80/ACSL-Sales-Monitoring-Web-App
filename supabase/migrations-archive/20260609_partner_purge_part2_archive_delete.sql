-- ============================================================================
-- PARTNER PURGE — PART 2 of 2: ARCHIVE -> DELETE -> (restore available).
--
-- Operates on the most recent batch with status='candidates' from Part 1.
-- RUN STEP C (archive) FIRST and verify counts. Only then run STEP D (delete).
--
-- Everything is copied into purge_archive.* before anything is removed, so a
-- full restore is possible (STEP F).
-- ============================================================================

-- Convenience: the active batch id = latest candidates batch.
--   SELECT batch_id FROM purge_archive.batch WHERE status='candidates' ORDER BY created_at DESC LIMIT 1;


-- ─────────────────────── STEP C: ARCHIVE (copies, deletes nothing) ─────────

-- C1. Snapshot tables (structure only; no FKs, so they can't block anything).
CREATE TABLE IF NOT EXISTS purge_archive.s_organizations            (LIKE public.organizations);
CREATE TABLE IF NOT EXISTS purge_archive.s_profiles                 (LIKE public.profiles);
CREATE TABLE IF NOT EXISTS purge_archive.s_credentials             (LIKE public.credentials);
CREATE TABLE IF NOT EXISTS purge_archive.s_sales                    (LIKE public.sales);
CREATE TABLE IF NOT EXISTS purge_archive.s_installment_payments     (LIKE public.installment_payments);
CREATE TABLE IF NOT EXISTS purge_archive.s_sales_history            (LIKE public.sales_history);
CREATE TABLE IF NOT EXISTS purge_archive.s_stove_ids                (LIKE public.stove_ids_base);
CREATE TABLE IF NOT EXISTS purge_archive.s_org_payment_models       (LIKE public.organization_payment_models);
CREATE TABLE IF NOT EXISTS purge_archive.s_acsl_agent_organizations (LIKE public.acsl_agent_organizations);
CREATE TABLE IF NOT EXISTS purge_archive.s_stove_transfer_history   (LIKE public.stove_transfer_history);
-- auth.users has generated columns, so store it as jsonb (robust + restorable).
CREATE TABLE IF NOT EXISTS purge_archive.s_auth_users (batch_id uuid, id uuid, data jsonb);

-- add batch_id tag to the structural snapshots
ALTER TABLE purge_archive.s_organizations            ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_profiles                 ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_credentials             ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_sales                    ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_installment_payments     ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_sales_history            ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_stove_ids                ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_org_payment_models       ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_acsl_agent_organizations ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE purge_archive.s_stove_transfer_history   ADD COLUMN IF NOT EXISTS batch_id uuid;

ALTER TABLE purge_archive.s_organizations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_credentials             ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_sales                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_installment_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_sales_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_stove_ids                ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_org_payment_models       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_acsl_agent_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_stove_transfer_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_archive.s_auth_users               ENABLE ROW LEVEL SECURITY;

-- C2. Do the archive in one transaction.
DO $$
DECLARE
  b uuid := (SELECT batch_id FROM purge_archive.batch WHERE status='candidates' ORDER BY created_at DESC LIMIT 1);
BEGIN
  IF b IS NULL THEN RAISE EXCEPTION 'No candidates batch found'; END IF;

  -- org-scoped tables
  INSERT INTO purge_archive.s_organizations            SELECT o.*, b FROM organizations o            WHERE o.id              IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_profiles                 SELECT p.*, b FROM profiles p                 WHERE p.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_credentials             SELECT c.*, b FROM credentials c               WHERE c.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_sales                    SELECT s.*, b FROM sales s                     WHERE s.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_stove_ids                SELECT s.*, b FROM stove_ids_base s            WHERE s.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_org_payment_models       SELECT m.*, b FROM organization_payment_models m WHERE m.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_acsl_agent_organizations SELECT a.*, b FROM acsl_agent_organizations a  WHERE a.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);
  INSERT INTO purge_archive.s_stove_transfer_history   SELECT t.*, b FROM stove_transfer_history t     WHERE t.organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b);

  -- sales-scoped tables
  INSERT INTO purge_archive.s_installment_payments SELECT ip.*, b FROM installment_payments ip
    WHERE ip.sale_id IN (SELECT id FROM sales WHERE organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b));
  INSERT INTO purge_archive.s_sales_history SELECT sh.*, b FROM sales_history sh
    WHERE sh.sale_id IN (SELECT id FROM sales WHERE organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b));

  -- auth users tied to these orgs (via profile id and credential user_id)
  INSERT INTO purge_archive.s_auth_users (batch_id, id, data)
  SELECT b, u.id, to_jsonb(u.*)
  FROM auth.users u
  WHERE u.id IN (
    SELECT id FROM profiles WHERE organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b)
    UNION
    SELECT user_id FROM credentials WHERE organization_id IN (SELECT organization_id FROM purge_archive.candidate_orgs WHERE batch_id=b) AND user_id IS NOT NULL
  );

  UPDATE purge_archive.batch SET status='archived' WHERE batch_id=b;
  RAISE NOTICE 'Archived batch %', b;
END $$;

-- C3. VERIFY archive matches live (run separately; numbers must match B5 + auth):
--   SELECT
--     (SELECT count(*) FROM purge_archive.s_organizations)            AS orgs,
--     (SELECT count(*) FROM purge_archive.s_profiles)                 AS profiles,
--     (SELECT count(*) FROM purge_archive.s_credentials)             AS credentials,
--     (SELECT count(*) FROM purge_archive.s_sales)                    AS sales,
--     (SELECT count(*) FROM purge_archive.s_stove_ids)                AS stoves,
--     (SELECT count(*) FROM purge_archive.s_stove_transfer_history)   AS transfer_history,
--     (SELECT count(*) FROM purge_archive.s_auth_users)               AS auth_users;


-- ─────────────────────── STEP D: DELETE (DESTRUCTIVE) ──────────────────────
-- Run ONLY after C3 looks right. FK-safe order, single transaction.
-- DO $$
-- DECLARE
--   b uuid := (SELECT batch_id FROM purge_archive.batch WHERE status='archived' ORDER BY created_at DESC LIMIT 1);
--   orgs uuid[] := (SELECT array_agg(organization_id) FROM purge_archive.candidate_orgs WHERE batch_id=b);
--   sale_ids uuid[] := (SELECT array_agg(id) FROM sales WHERE organization_id = ANY(orgs));
--   user_ids uuid[];
-- BEGIN
--   IF b IS NULL THEN RAISE EXCEPTION 'No archived batch found'; END IF;
--
--   user_ids := (
--     SELECT array_agg(DISTINCT uid) FROM (
--       SELECT id AS uid FROM profiles WHERE organization_id = ANY(orgs)
--       UNION
--       SELECT user_id FROM credentials WHERE organization_id = ANY(orgs) AND user_id IS NOT NULL
--     ) q
--   );
--
--   DELETE FROM installment_payments      WHERE sale_id = ANY(sale_ids);
--   DELETE FROM sales_history             WHERE sale_id = ANY(sale_ids);
--   DELETE FROM stove_ids_base            WHERE organization_id = ANY(orgs);
--   DELETE FROM sales                     WHERE organization_id = ANY(orgs);
--   DELETE FROM organization_payment_models WHERE organization_id = ANY(orgs);
--   DELETE FROM acsl_agent_organizations  WHERE organization_id = ANY(orgs);
--   DELETE FROM stove_transfer_history    WHERE organization_id = ANY(orgs);
--   DELETE FROM credentials               WHERE organization_id = ANY(orgs);
--   DELETE FROM profiles                  WHERE organization_id = ANY(orgs);
--   DELETE FROM organizations             WHERE id = ANY(orgs);
--
--   -- auth last (cascades to auth.identities/sessions/refresh_tokens)
--   DELETE FROM auth.users WHERE id = ANY(user_ids);
--
--   UPDATE purge_archive.batch SET status='deleted' WHERE batch_id=b;
--   RAISE NOTICE 'Deleted batch %: % orgs, % users', b, array_length(orgs,1), array_length(user_ids,1);
-- END $$;


-- ─────────────────────── STEP F: RESTORE (only if needed) ──────────────────
-- Re-inserts everything from the archive for a given batch. auth.users is
-- restored from the jsonb snapshot (encrypted_password preserved, so logins
-- work again). Generated columns (e.g. confirmed_at) are skipped automatically.
-- Provided as a template — tell me and I'll tailor the exact restore run.

-- ============================================================================
-- PARTNER PURGE — PART 1 of 2: backup infrastructure + IDENTIFY ONLY.
--
-- This file creates a dedicated backup schema and a frozen "batch" of partners
-- that would be deleted. It DELETES NOTHING. Part 2 (separate file) does the
-- archive + delete, and only after you review the candidate list produced here.
--
-- Rule: an organization SURVIVES if it has >= 1 stove with
--       transfer_sales_date >= 2026-01-01. Otherwise it is a purge candidate.
--
-- Safety filters baked in:
--   * never a candidate if it has zero stoves AND the org owns an elevated-role
--     profile (super_admin/admin/agent...) — staff orgs are protected.
--   * candidates are frozen into a table so archive/delete act on an exact set.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS purge_archive;

-- Batch registry (one row per purge run)
CREATE TABLE IF NOT EXISTS purge_archive.batch (
  batch_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  cutoff     date NOT NULL,
  note       text,
  status     text NOT NULL DEFAULT 'candidates'  -- candidates | archived | deleted | restored
);

-- Frozen candidate organizations for a batch
CREATE TABLE IF NOT EXISTS purge_archive.candidate_orgs (
  batch_id        uuid NOT NULL REFERENCES purge_archive.batch(batch_id),
  organization_id uuid NOT NULL,
  partner_name    text,
  partner_type    text,
  reason          text,
  PRIMARY KEY (batch_id, organization_id)
);


-- ─────────────────────── GUARD: no undatable stoves left ───────────────────
-- The rule needs accurate dates. Run this FIRST. It must return 0.
-- If it's > 0, finish the ERP backfill before going further.
--   SELECT count(*) AS undatable_stoves
--   FROM stove_ids_base
--   WHERE transfer_sales_date IS NULL;


-- ─────────────────────── STEP A: freeze a candidate batch ──────────────────
-- Creates a batch and fills candidate_orgs. Still deletes nothing.
DO $$
DECLARE
  v_batch uuid;
BEGIN
  INSERT INTO purge_archive.batch (cutoff, note)
  VALUES ('2026-01-01', 'auto: orgs with no 2026+ stove')
  RETURNING batch_id INTO v_batch;

  INSERT INTO purge_archive.candidate_orgs (batch_id, organization_id, partner_name, partner_type, reason)
  SELECT
    v_batch,
    o.id,
    o.partner_name,
    o.partner_type,
    CASE
      WHEN s.org IS NULL THEN 'no stoves at all'
      ELSE 'all stoves pre-2026'
    END
  FROM organizations o
  LEFT JOIN (SELECT DISTINCT organization_id AS org FROM stove_ids_base) s
         ON s.org = o.id
  WHERE
    -- no 2026+ stove
    o.id NOT IN (
      SELECT organization_id FROM stove_ids_base
      WHERE transfer_sales_date >= '2026-01-01' AND organization_id IS NOT NULL
    )
    -- protect staff orgs: skip any org that owns an elevated-role profile
    AND o.id NOT IN (
      SELECT organization_id FROM profiles
      WHERE organization_id IS NOT NULL
        AND role IS DISTINCT FROM 'partner'
        AND role IS DISTINCT FROM 'customer'
    );

  RAISE NOTICE 'Batch % created with % candidate orgs',
    v_batch, (SELECT count(*) FROM purge_archive.candidate_orgs WHERE batch_id = v_batch);
END $$;


-- ─────────────────────── STEP B: REVIEW the candidate batch ────────────────
-- (run these SELECTs and paste results back before Part 2)

-- B1. The batch you just created + how many candidates:
--   SELECT b.batch_id, b.created_at, b.cutoff, b.status,
--          (SELECT count(*) FROM purge_archive.candidate_orgs c WHERE c.batch_id = b.batch_id) AS candidates
--   FROM purge_archive.batch b ORDER BY b.created_at DESC;

-- B2. Sanity: how many orgs total vs candidates vs survivors:
--   SELECT
--     (SELECT count(*) FROM organizations) AS total_orgs,
--     (SELECT count(*) FROM purge_archive.candidate_orgs
--        WHERE batch_id = (SELECT batch_id FROM purge_archive.batch ORDER BY created_at DESC LIMIT 1)) AS to_delete;

-- B3. Candidate breakdown by partner_type and reason (make sure it's partners, not staff):
--   SELECT partner_type, reason, count(*)
--   FROM purge_archive.candidate_orgs
--   WHERE batch_id = (SELECT batch_id FROM purge_archive.batch ORDER BY created_at DESC LIMIT 1)
--   GROUP BY 1,2 ORDER BY 1,2;

-- B4. What ROLES do the to-be-deleted orgs' profiles have? (must be partner/customer only):
--   SELECT p.role, count(*)
--   FROM profiles p
--   WHERE p.organization_id IN (
--     SELECT organization_id FROM purge_archive.candidate_orgs
--     WHERE batch_id = (SELECT batch_id FROM purge_archive.batch ORDER BY created_at DESC LIMIT 1))
--   GROUP BY 1 ORDER BY 2 DESC;

-- B5. How many related rows would be archived+deleted (impact preview):
--   WITH c AS (
--     SELECT organization_id AS org FROM purge_archive.candidate_orgs
--     WHERE batch_id = (SELECT batch_id FROM purge_archive.batch ORDER BY created_at DESC LIMIT 1))
--   SELECT
--     (SELECT count(*) FROM profiles            WHERE organization_id IN (SELECT org FROM c)) AS profiles,
--     (SELECT count(*) FROM credentials         WHERE organization_id IN (SELECT org FROM c)) AS credentials,
--     (SELECT count(*) FROM sales               WHERE organization_id IN (SELECT org FROM c)) AS sales,
--     (SELECT count(*) FROM stove_ids_base      WHERE organization_id IN (SELECT org FROM c)) AS stoves,
--     (SELECT count(*) FROM stove_transfer_history WHERE organization_id IN (SELECT org FROM c)) AS transfer_history;

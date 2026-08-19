-- ============================================================================
-- Migration: Role Nomenclature Renaming
-- Date: 2026-03-30
-- Purpose: Rename user roles for the entire system
--   super_admin       → super_admin (no change)
--   super_admin_agent → acsl_agent
--   admin             → partner
--   agent             → partner_agent
--
-- BACKWARD COMPATIBILITY:
--   1. Database trigger auto-maps old role values to new on INSERT/UPDATE
--   2. Views with old table names point to renamed tables
--   3. Auth metadata updated for all existing users
-- ============================================================================

-- ============================================================================
-- STEP 1: Update existing role values in profiles
-- ============================================================================
UPDATE profiles SET role = 'acsl_agent' WHERE role = 'super_admin_agent';
UPDATE profiles SET role = 'partner' WHERE role = 'admin';
UPDATE profiles SET role = 'partner_agent' WHERE role = 'agent';

-- ============================================================================
-- STEP 2: Update existing role values in credentials
-- ============================================================================
UPDATE credentials SET role = 'acsl_agent' WHERE role = 'super_admin_agent';
UPDATE credentials SET role = 'partner' WHERE role = 'admin';
UPDATE credentials SET role = 'partner_agent' WHERE role = 'agent';

-- ============================================================================
-- STEP 3: Update auth.users metadata (raw_user_meta_data)
-- ============================================================================
UPDATE auth.users SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{role}', '"acsl_agent"')
WHERE raw_user_meta_data->>'role' = 'super_admin_agent';
UPDATE auth.users SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{role}', '"partner"')
WHERE raw_user_meta_data->>'role' = 'admin';
UPDATE auth.users SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{role}', '"partner_agent"')
WHERE raw_user_meta_data->>'role' = 'agent';

-- ============================================================================
-- STEP 4: Update auth.users metadata (raw_app_meta_data)
-- ============================================================================
UPDATE auth.users SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{role}', '"acsl_agent"')
WHERE raw_app_meta_data->>'role' = 'super_admin_agent';
UPDATE auth.users SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{role}', '"partner"')
WHERE raw_app_meta_data->>'role' = 'admin';
UPDATE auth.users SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{role}', '"partner_agent"')
WHERE raw_app_meta_data->>'role' = 'agent';

-- ============================================================================
-- STEP 5: Rename tables
-- ============================================================================
ALTER TABLE super_admin_agent_organizations RENAME TO acsl_agent_organizations;
ALTER TABLE super_admin_agent_states RENAME TO acsl_agent_states;

-- ============================================================================
-- STEP 6: Create backward-compat views (old table names still work)
-- ============================================================================
CREATE VIEW super_admin_agent_organizations AS SELECT * FROM acsl_agent_organizations;
CREATE VIEW super_admin_agent_states AS SELECT * FROM acsl_agent_states;

-- ============================================================================
-- STEP 7: Create legacy role mapping trigger
-- Any INSERT/UPDATE with old role values auto-maps to new values
-- This is a safety net for any code that still uses old role names
-- ============================================================================
CREATE OR REPLACE FUNCTION map_legacy_roles()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'super_admin_agent' THEN NEW.role := 'acsl_agent'; END IF;
  IF NEW.role = 'admin' THEN NEW.role := 'partner'; END IF;
  IF NEW.role = 'agent' THEN NEW.role := 'partner_agent'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to profiles table
CREATE TRIGGER trg_map_legacy_roles_profiles
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION map_legacy_roles();

-- Apply to credentials table
CREATE TRIGGER trg_map_legacy_roles_credentials
BEFORE INSERT OR UPDATE ON credentials
FOR EACH ROW EXECUTE FUNCTION map_legacy_roles();

-- ============================================================================
-- STEP 8: Rename indexes on the renamed tables (cosmetic, for clarity)
-- ============================================================================
-- ALTER INDEX idx_saao_agent_id RENAME TO idx_acsl_org_agent_id;
-- ALTER INDEX idx_saao_org_id RENAME TO idx_acsl_org_org_id;
-- ALTER INDEX idx_saas_agent_id RENAME TO idx_acsl_state_agent_id;
-- ALTER INDEX idx_saas_state RENAME TO idx_acsl_state_state;
-- NOTE: Index renames are commented out as they are cosmetic only.
-- Uncomment if you want cleaner index names.

-- ============================================================================
-- VERIFICATION QUERIES (run these after the migration to confirm)
-- ============================================================================
-- SELECT DISTINCT role FROM profiles ORDER BY role;
-- Expected: acsl_agent, partner, partner_agent, super_admin
--
-- SELECT DISTINCT role FROM credentials ORDER BY role;
-- Expected: acsl_agent, partner, partner_agent, super_admin
--
-- Test trigger: INSERT INTO profiles (id, role, ...) VALUES (..., 'admin', ...);
-- Then SELECT role FROM profiles WHERE id = ...; → should be 'partner'

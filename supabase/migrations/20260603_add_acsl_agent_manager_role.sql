-- Add acsl_agent_manager role to the system
-- This role sits between super_admin and acsl_agent:
--   super_admin → acsl_agent_manager → acsl_agent
-- The manager is a real ACSL staff member assigned to specific states and partners.
-- They can create acsl_agent accounts scoped to their assigned states/partners.

-- STEP 1: Allow the new role value in profiles
-- The profiles table uses a text column (no enum), so no type change needed.
-- The map_legacy_roles trigger already handles unknown values safely.

-- STEP 2: Add manager_id FK to profiles so each acsl_agent knows who created them
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Index for fast lookup of "agents under manager X"
CREATE INDEX IF NOT EXISTS idx_profiles_manager_id ON profiles(manager_id);

-- STEP 3: Extend the legacy role mapping trigger to be aware of the new role
-- (no change needed — it only remaps old role strings, acsl_agent_manager is new)

-- STEP 4: Verification queries (run manually to confirm)
-- SELECT DISTINCT role FROM profiles ORDER BY role;
-- SELECT DISTINCT role FROM credentials ORDER BY role;

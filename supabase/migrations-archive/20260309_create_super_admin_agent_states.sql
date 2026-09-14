-- Migration: Create junction table for Super Admin Agent ↔ State assignments
-- Purpose: Tracks which states each super_admin_agent is assigned to monitor.
-- When assigned to a state, the SAA gets access to ALL organizations in that state.
-- This works alongside super_admin_agent_organizations (direct org assignments).

CREATE TABLE IF NOT EXISTS super_admin_agent_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  assigned_by UUID NOT NULL REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, state)
);

-- Index for fast lookup by agent
CREATE INDEX IF NOT EXISTS idx_saas_agent_id
  ON super_admin_agent_states(agent_id);

-- Index for fast lookup by state
CREATE INDEX IF NOT EXISTS idx_saas_state
  ON super_admin_agent_states(state);

-- Enable Row Level Security
ALTER TABLE super_admin_agent_states ENABLE ROW LEVEL SECURITY;

-- Super admins have full access
CREATE POLICY "super_admin_full_access" ON super_admin_agent_states
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Super admin agents can read their own assignments only
CREATE POLICY "agent_read_own" ON super_admin_agent_states
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid());

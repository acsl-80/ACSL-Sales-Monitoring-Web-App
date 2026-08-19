-- Migration: Create junction table for Super Admin Agent ↔ Organization assignments
-- Run this AFTER the agent_approved columns migration.
-- Purpose: Tracks which organizations each super_admin_agent is assigned to monitor.
-- Note: super_admin_agent users do NOT own organizations (profiles.organization_id = NULL).
--       Their org associations live exclusively in this table.

CREATE TABLE IF NOT EXISTS super_admin_agent_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, organization_id)
);

-- Index for fast lookup by agent
CREATE INDEX IF NOT EXISTS idx_saao_agent_id
  ON super_admin_agent_organizations(agent_id);

-- Index for fast lookup by organization
CREATE INDEX IF NOT EXISTS idx_saao_org_id
  ON super_admin_agent_organizations(organization_id);

-- Enable Row Level Security
ALTER TABLE super_admin_agent_organizations ENABLE ROW LEVEL SECURITY;

-- Super admins have full access
CREATE POLICY "super_admin_full_access" ON super_admin_agent_organizations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profilesli
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Super admin agents can read their own assignments only
CREATE POLICY "agent_read_own" ON super_admin_agent_organizations
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid());

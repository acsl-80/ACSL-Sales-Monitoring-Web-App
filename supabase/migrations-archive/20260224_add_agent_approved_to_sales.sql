-- Migration: Add agent_approved columns to sales table
-- Run this in the Supabase SQL editor BEFORE the junction table migration.
-- Purpose: Allows super_admin_agent users to mark sales as approved.

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS agent_approved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_approved_by UUID REFERENCES profiles(id);

-- Index for fast queries of unapproved sales
CREATE INDEX IF NOT EXISTS idx_sales_agent_approved
  ON sales(agent_approved)
  WHERE agent_approved = FALSE;

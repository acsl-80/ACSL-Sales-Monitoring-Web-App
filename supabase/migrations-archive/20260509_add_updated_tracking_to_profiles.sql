-- Add updated_at and updated_by audit columns to profiles
-- updated_at: timestamp of the last admin-initiated profile edit
-- updated_by: profile ID of the admin who made the change
-- NOTE: These are only written by the updateAgent edge function,
--       NOT by triggers, so they reflect intentional admin edits only.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Backfill: set updated_at = created_at for all existing rows
UPDATE profiles
SET updated_at = created_at
WHERE updated_at IS NULL;

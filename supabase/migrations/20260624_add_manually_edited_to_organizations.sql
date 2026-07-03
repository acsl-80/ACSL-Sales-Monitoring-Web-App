-- Add manually_edited flag to organizations table
-- When true, external sync (external-csv-sync, external-sync) will not override
-- contact details (phone, email, address, etc.) for this organization.
-- Only stove ID assignments are still processed.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS manually_edited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.manually_edited IS
  'Set to true when a super admin has manually edited contact details. Prevents ERP sync from overriding these fields.';

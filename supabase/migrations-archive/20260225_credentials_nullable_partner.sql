-- Make partner_id and organization_id nullable in credentials table
-- SAA and Super Admin users have no partner_id or organization_id
ALTER TABLE credentials ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE credentials ALTER COLUMN organization_id DROP NOT NULL;

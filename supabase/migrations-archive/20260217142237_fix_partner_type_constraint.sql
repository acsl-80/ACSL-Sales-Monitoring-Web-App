-- Fix partner_type constraint to allow 'partner' instead of 'individual'
-- Migration Date: 2026-02-17
-- Purpose: Correct the check constraint to allow 'partner' and 'customer' values

-- Drop the existing constraint (if it exists with wrong values)
ALTER TABLE public.organizations
DROP CONSTRAINT IF EXISTS organizations_partner_type_check;

-- Add the correct constraint
ALTER TABLE public.organizations
ADD CONSTRAINT organizations_partner_type_check
CHECK (partner_type IS NULL OR partner_type IN ('partner', 'customer'));

-- Update the column comment
COMMENT ON COLUMN public.organizations.partner_type IS 'Type of partner: partner or customer';

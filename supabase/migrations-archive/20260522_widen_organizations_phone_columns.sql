-- Widen phone columns in organizations to support longer/combined phone numbers
ALTER TABLE organizations
  ALTER COLUMN contact_phone TYPE TEXT,
  ALTER COLUMN alternative_phone TYPE TEXT;

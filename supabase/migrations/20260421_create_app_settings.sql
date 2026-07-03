-- App-wide settings table for super admin managed configuration
-- Stores sensitive API keys and config that was previously only in .env

CREATE TABLE IF NOT EXISTS app_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  google_places_api_key text,
  brevo_api_key text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

-- Seed a single row on first creation
INSERT INTO app_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_full_access" ON app_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

CREATE POLICY "service_role_read" ON app_settings
  FOR SELECT
  USING (auth.role() = 'service_role');

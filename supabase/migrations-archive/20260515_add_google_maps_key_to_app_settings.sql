-- Add Google Maps API key to app_settings
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS google_maps_api_key text;

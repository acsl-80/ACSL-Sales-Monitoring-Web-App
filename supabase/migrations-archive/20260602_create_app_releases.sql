-- Single-row config table for the mobile app release info.
-- One fixed row (ID = 00000000-0000-0000-0000-000000000002) is always upserted.

create table if not exists app_releases (
  id uuid primary key default '00000000-0000-0000-0000-000000000002'::uuid,
  version text not null default '1.0.0',
  release_notes text not null default '',
  base_url text not null default '',
  apk_path text not null default '/downloads/sales-monitoring-app.apk',
  is_force_update boolean not null default false,
  size text not null default '~45 MB',
  requires text not null default 'Android 8.0+',
  features jsonb not null default '[]'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Seed the initial row
insert into app_releases (
  id,
  version,
  release_notes,
  base_url,
  apk_path,
  is_force_update,
  size,
  requires,
  features,
  requirements
) values (
  '00000000-0000-0000-0000-000000000002'::uuid,
  '1.0.0',
  'Initial release of the Atmosfair Sales Monitoring App.',
  '',
  '/downloads/sales-monitoring-app.apk',
  false,
  '~45 MB',
  'Android 8.0+',
  '[
    {"title": "Real-time Sales Tracking", "description": "Record and monitor sales transactions instantly with live sync to the central dashboard."},
    {"title": "Performance Analytics", "description": "View your sales performance metrics, targets, and achievements at a glance."},
    {"title": "Offline-first Architecture", "description": "Continue recording sales without an internet connection. Data syncs automatically when back online."},
    {"title": "Secure Role-based Access", "description": "Enterprise-grade security with permissions scoped to each user role."}
  ]'::jsonb,
  '[
    "Android 8.0 (Oreo) or higher",
    "At least 150 MB free storage space",
    "Active Atmosfair account credentials",
    "Internet connection for initial setup and sync"
  ]'::jsonb
) on conflict (id) do nothing;

-- RLS: enabled. The edge function uses the service role key so it bypasses RLS.
-- Direct anon/user JWTs can only read; no direct writes are allowed.
alter table app_releases enable row level security;

create policy "Public can read app release"
  on app_releases for select
  using (true);


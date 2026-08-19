-- Migration: Fix Supabase Security Advisor CRITICAL findings (16 Jul 2026)
--
-- Addresses five flagged items without breaking any live caller:
--   1. external_app_tokens          — RLS off, exposes secret_key/token via API
--   2. organizations_backup_...     — RLS off backup table exposed via API
--   3. super_admin_agent_organizations (view) — SECURITY DEFINER, bypasses RLS
--   4. super_admin_agent_states      (view)   — SECURITY DEFINER, bypasses RLS
--
-- Why this is safe:
--   * external_app_tokens is only ever read/written by edge functions
--     (manage-app-tokens, external-sync, external-csv-sync) which use the
--     service-role key — service role BYPASSES RLS, so enabling RLS with no
--     policies locks the table to those functions and closes the public API.
--   * organizations_backup_20251002 is a leftover backup referenced nowhere in
--     code; same treatment. Drop it later if you don't need it (commented below).
--   * The two views are backward-compat shims over the renamed acsl_agent_*
--     tables (see 20260330_rename_roles_nomenclature.sql). Recreating them with
--     security_invoker = true makes them honor the CALLER's RLS. The underlying
--     acsl_agent_* tables already carry the right policies (super_admin full
--     access + agents read own), so authenticated queries keep working.

-- ── 1. external_app_tokens: lock to service-role only ───────────────────────
ALTER TABLE public.external_app_tokens ENABLE ROW LEVEL SECURITY;
-- No policies added on purpose: authenticated/anon get zero rows; the
-- service-role edge functions bypass RLS and are unaffected.

-- ── 2. organizations_backup_20251002: lock to service-role only ─────────────
ALTER TABLE public.organizations_backup_20251002 ENABLE ROW LEVEL SECURITY;
-- If you have confirmed the backup is no longer needed, you can instead drop it:
-- DROP TABLE IF EXISTS public.organizations_backup_20251002;

-- ── 3 & 4. Make the compat views run as the CALLER (respect RLS) ────────────
-- Recreating with the same definition + security_invoker; underlying tables
-- (acsl_agent_organizations / acsl_agent_states) enforce their own policies.
CREATE OR REPLACE VIEW public.super_admin_agent_organizations
  WITH (security_invoker = true) AS
  SELECT * FROM public.acsl_agent_organizations;

CREATE OR REPLACE VIEW public.super_admin_agent_states
  WITH (security_invoker = true) AS
  SELECT * FROM public.acsl_agent_states;

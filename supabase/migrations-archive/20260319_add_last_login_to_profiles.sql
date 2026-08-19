-- ============================================================================
-- Migration: Add last_login to profiles
-- Date: 2026-03-19
-- Description: Adds last_login column to profiles table and a trigger that
--              keeps it in sync with auth.users.last_sign_in_at on every login.
-- ============================================================================

-- 1. Add the column (nullable — existing users have no login record yet)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ DEFAULT NULL;

-- 2. Back-fill from auth.users for users who have already logged in
UPDATE public.profiles p
SET last_login = a.last_sign_in_at
FROM auth.users a
WHERE a.id = p.id
  AND a.last_sign_in_at IS NOT NULL;

-- 3. Trigger function — fires after auth.users is updated (i.e. on every sign-in)
CREATE OR REPLACE FUNCTION public.sync_last_login()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when last_sign_in_at actually changes
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.profiles
    SET last_login = NEW.last_sign_in_at
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_login ON auth.users;
CREATE TRIGGER on_auth_user_login
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_last_login();

-- Create a function to check if a profile email exists (bypasses RLS)
-- This function runs with SECURITY DEFINER which means it runs with the privileges
-- of the user who created it (not the user who calls it), bypassing RLS

CREATE OR REPLACE FUNCTION public.check_profile_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE email = p_email
  );
END;
$$;

-- Grant execute permission to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.check_profile_email_exists(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_profile_email_exists(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_profile_email_exists(text) TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION public.check_profile_email_exists(text) IS 
'Checks if a profile with the given email exists. Runs with SECURITY DEFINER to bypass RLS policies.';

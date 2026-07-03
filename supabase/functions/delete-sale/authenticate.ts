// Authentication module for delete-sale
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function authenticate(supabase: any, authHeader: string) {
  if (!authHeader) {
    throw new Error("Unauthorized: Authorization required");
  }

  const userSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: authError } = await userSupabase.auth.getUser();

  if (authError || !userData?.user) {
    throw new Error("Unauthorized: Invalid or missing authentication token");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, organization_id")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unauthorized: User profile not found");
  }

  if (!["partner", "partner_agent", "admin", "super_admin"].includes(profile.role)) {
    throw new Error("Unauthorized: Admin privileges required to delete sales");
  }

  return {
    userId: profile.id,
    userRole: profile.role,
    organizationId: profile.organization_id,
  };
}

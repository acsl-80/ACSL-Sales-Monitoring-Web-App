// Read operations for credentials management
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface CredentialRecord {
  id: string;
  partner_id: string;
  partner_name: string;
  email?: string;
  username?: string;
  password: string;
  role?: string;
  organization_id: string;
  user_id: string;
  is_dummy_email: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Get all credentials (Super Admin only)
 */
export async function getAllCredentials(supabase: SupabaseClient): Promise<{
  success: boolean;
  data?: CredentialRecord[];
  error?: string;
  count?: number;
}> {
  try {
    // Fetch partner credentials only (exclude super_admin / super_admin_agent entries)
    const { data, error, count } = await supabase
      .from("credentials")
      .select(
        `
        *,
        organizations:organization_id (
          partner_name,
          email,
          contact_person,
          contact_phone,
          state,
          branch
        )
      `,
        { count: "exact" }
      )
      .not("partner_id", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching credentials:", error);
      return { success: false, error: error.message };
    }

    // Map credentials to include email and username consistently
    const mappedData = (data || []).map((cred: any) => {
      const result: any = {
        id: cred.id,
        partner_id: cred.partner_id,
        partner_name: cred.partner_name,
        email: cred.email, // Always include email
        username: cred.username, // Always include username
        password: cred.password,
        role: cred.role || "admin", // Include role, default to admin if not set
        organization_id: cred.organization_id,
        user_id: cred.user_id,
        is_dummy_email: cred.is_dummy_email,
        created_at: cred.created_at,
        updated_at: cred.updated_at,
        organizations: cred.organizations,
      };

      return result;
    });

    return {
      success: true,
      data: mappedData,
      count: count || 0,
    };
  } catch (error) {
    console.error("Unexpected error fetching credentials:", error);
    return { success: false, error: "Failed to fetch credentials" };
  }
}

/**
 * Get credentials by user role (for SAA and Super Admin tabs)
 */
export async function getCredentialsByRole(
  supabase: SupabaseClient,
  role: string
): Promise<{
  success: boolean;
  data?: CredentialRecord[];
  error?: string;
  count?: number;
}> {
  try {
    const { data, error, count } = await supabase
      .from("credentials")
      .select(
        "id, user_id, email, username, password, role, partner_name, created_at, updated_at",
        { count: "exact" }
      )
      .eq("role", role)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching credentials by role:", error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: data || [],
      count: count || 0,
    };
  } catch (error) {
    console.error("Unexpected error fetching credentials by role:", error);
    return { success: false, error: "Failed to fetch credentials" };
  }
}

/**
 * Get credential by partner ID
 */
export async function getCredentialByPartnerId(
  supabase: SupabaseClient,
  partnerId: string
): Promise<{ success: boolean; data?: CredentialRecord; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("credentials")
      .select(
        `
        *,
        organizations:organization_id (
          partner_name,
          email,
          contact_person,
          contact_phone,
          state,
          branch
        )
      `
      )
      .eq("partner_id", partnerId)
      .single();

    if (error) {
      console.error("Error fetching credential:", error);
      return { success: false, error: error.message };
    }

    // Map credential to include email and username consistently
    const result: any = {
      id: data.id,
      partner_id: data.partner_id,
      partner_name: data.partner_name,
      email: data.email, // Always include email
      username: data.username, // Always include username
      password: data.password,
      role: data.role || "admin", // Include role, default to admin if not set
      organization_id: data.organization_id,
      user_id: data.user_id,
      is_dummy_email: data.is_dummy_email,
      created_at: data.created_at,
      updated_at: data.updated_at,
      organizations: data.organizations,
    };

    return { success: true, data: result };
  } catch (error) {
    console.error("Unexpected error fetching credential:", error);
    return { success: false, error: "Failed to fetch credential" };
  }
}

/**
 * Get credential by organization ID
 */
export async function getCredentialByOrganizationId(
  supabase: SupabaseClient,
  organizationId: string
): Promise<{ success: boolean; data?: CredentialRecord; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("credentials")
      .select(
        `
        *,
        organizations:organization_id (
          partner_name,
          email,
          contact_person,
          contact_phone,
          state,
          branch
        )
      `
      )
      .eq("organization_id", organizationId)
      .single();

    if (error) {
      console.error("Error fetching credential:", error);
      return { success: false, error: error.message };
    }

    // Map credential to include email and username consistently
    const result: any = {
      id: data.id,
      partner_id: data.partner_id,
      partner_name: data.partner_name,
      email: data.email, // Always include email
      username: data.username, // Always include username
      password: data.password,
      role: data.role || "admin", // Include role, default to admin if not set
      organization_id: data.organization_id,
      user_id: data.user_id,
      is_dummy_email: data.is_dummy_email,
      created_at: data.created_at,
      updated_at: data.updated_at,
      organizations: data.organizations,
    };

    return { success: true, data: result };
  } catch (error) {
    console.error("Unexpected error fetching credential:", error);
    return { success: false, error: "Failed to fetch credential" };
  }
}

/**
 * Get credential by user ID (for ACSL agents / agent managers)
 */
export async function getCredentialByUserId(
  supabase: SupabaseClient,
  userId: string
): Promise<{ success: boolean; data?: CredentialRecord; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("credentials")
      .select("id, user_id, profile_id, email, username, password, role, partner_name, is_dummy_email, created_at, updated_at")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.error("Error fetching credential by user_id:", error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        id: data.id,
        partner_name: data.partner_name,
        email: data.email,
        username: data.username,
        password: data.password,
        role: data.role,
        user_id: data.user_id,
        is_dummy_email: data.is_dummy_email ?? false,
        created_at: data.created_at,
        updated_at: data.updated_at,
      } as CredentialRecord,
    };
  } catch (error) {
    console.error("Unexpected error fetching credential by user_id:", error);
    return { success: false, error: "Failed to fetch credential" };
  }
}

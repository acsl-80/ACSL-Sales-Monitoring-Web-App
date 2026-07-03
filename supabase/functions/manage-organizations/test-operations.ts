// Simple test function to create organization without user creation
import { validateOrganizationData } from "./validate.ts";

export async function createOrganizationSimple(
  supabase: any,
  data: any,
  userId: string
) {
  console.log("➕ Creating organization without admin user...");

  // Validate only organization fields - using new 8-field structure
  const orgData = {
    partner_name: data.partner_name,
    branch: data.branch,
    state: data.state,
    contact_person: data.contact_person,
    contact_phone: data.contact_phone,
    alternative_phone: data.alternative_phone,
    email: data.email,
    address: data.address,
  };

  // Simple validation - only 3 required fields
  if (!orgData.partner_name || !orgData.branch || !orgData.state) {
    throw new Error("Partner name, branch, and state are required");
  }

  // Create organization record - using new 8-field structure
  const organizationData = {
    id: crypto.randomUUID(),
    partner_name: orgData.partner_name,
    branch: orgData.branch,
    state: orgData.state,
    contact_person: orgData.contact_person || null,
    contact_phone: orgData.contact_phone || null,
    alternative_phone: orgData.alternative_phone || null,
    email: orgData.email || null,
    address: orgData.address || null,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: newOrganization, error: orgError } = await supabase
    .from("organizations")
    .insert([organizationData])
    .select()
    .single();

  if (orgError) {
    throw new Error(`Failed to create organization: ${orgError.message}`);
  }

  console.log("✅ Organization created successfully (without admin user)");

  return {
    data: {
      organization: newOrganization,
      message:
        "Organization created successfully. Admin user creation skipped for testing.",
    },
    message: "Organization created successfully",
  };
}

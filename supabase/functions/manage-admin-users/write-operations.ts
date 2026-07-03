// Create and update operations for admin users
import { validateAdminUserData } from "./validate.ts";

export async function createAdminUser(
  supabase: any,
  data: any,
  superAdminUserId: string
) {
  console.log("➕ Creating new admin user...");

  // Validate required fields
  const validationResult = validateAdminUserData(data, "create");
  if (!validationResult.isValid) {
    throw new Error(`Validation failed: ${validationResult.errors.join(", ")}`);
  }

  // Check if organization exists
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id, partner_name")
    .eq("id", data.organization_id)
    .single();

  if (orgError || !organization) {
    throw new Error(`Organization with ID ${data.organization_id} not found`);
  }

  // Check if user with email already exists
  const { data: existingUser, error: checkError } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("email", data.email)
    .single();

  if (existingUser) {
    throw new Error(`User with email "${data.email}" already exists`);
  }

  // Create user in Supabase Auth
  const { data: authUser, error: authError } =
    await supabase.auth.admin.createUser({
      email: data.email,
      password: data.password || generateRandomPassword(),
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        role: "admin",
        organization_id: data.organization_id,
      },
    });

  if (authError) {
    throw new Error(`Failed to create auth user: ${authError.message}`);
  }

  // Create profile record
  const profileData = {
    id: authUser.user.id,
    full_name: data.full_name,
    email: data.email,
    role: "admin",
    organization_id: data.organization_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: newProfile, error: profileError } = await supabase
    .from("profiles")
    .insert([profileData])
    .select(
      `
      id,
      full_name,
      email,
      role,
      organization_id,
      created_at,
      updated_at,
      organizations (
        id,
        partner_name,
        branch,
        state,
        contact_person,
        contact_phone,
        alternative_phone,
        email,
        address
      )
    `
    )
    .single();

  if (profileError) {
    // If profile creation fails, delete the auth user
    await supabase.auth.admin.deleteUser(authUser.user.id);
    throw new Error(`Failed to create user profile: ${profileError.message}`);
  }

  console.log(`✅ Admin user created successfully: ${newProfile.id}`);

  return {
    data: newProfile,
    message: "Admin user created successfully",
    auth_user_id: authUser.user.id,
  };
}

export async function updateAdminUser(
  supabase: any,
  adminUserId: string,
  data: any,
  superAdminUserId: string
) {
  console.log(`✏️ Updating admin user: ${adminUserId}`);

  // Validate data
  const validationResult = validateAdminUserData(data, "update");
  if (!validationResult.isValid) {
    throw new Error(`Validation failed: ${validationResult.errors.join(", ")}`);
  }

  // Check if admin user exists
  const { data: existingUser, error: checkError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, organization_id")
    .eq("id", adminUserId)
    .eq("role", "admin")
    .single();

  if (checkError || !existingUser) {
    throw new Error(`Admin user with ID ${adminUserId} not found`);
  }

  // Check if new email conflicts with existing users (if email is being updated)
  if (data.email && data.email !== existingUser.email) {
    const { data: emailConflict, error: emailError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", data.email)
      .neq("id", adminUserId)
      .single();

    if (emailConflict) {
      throw new Error(`User with email "${data.email}" already exists`);
    }
  }

  // Check if organization exists (if organization_id is being updated)
  if (
    data.organization_id &&
    data.organization_id !== existingUser.organization_id
  ) {
    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .select("id, partner_name")
      .eq("id", data.organization_id)
      .single();

    if (orgError || !organization) {
      throw new Error(`Organization with ID ${data.organization_id} not found`);
    }
  }

  // Prepare update data
  const updateData: any = {
    updated_at: new Date().toISOString(),
  };

  // Only update provided fields
  if (data.full_name !== undefined) updateData.full_name = data.full_name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.organization_id !== undefined)
    updateData.organization_id = data.organization_id;

  // Update profile
  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("id", adminUserId)
    .select(
      `
      id,
      full_name,
      email,
      role,
      organization_id,
      created_at,
      updated_at,
      organizations (
        id,
        partner_name,
        branch,
        state,
        contact_person,
        contact_phone,
        alternative_phone,
        email,
        address
      )
    `
    )
    .single();

  if (updateError) {
    throw new Error(`Failed to update admin user: ${updateError.message}`);
  }

  // Update auth user email if email was changed
  if (data.email && data.email !== existingUser.email) {
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
      adminUserId,
      {
        email: data.email,
        user_metadata: {
          full_name: updateData.full_name || existingUser.full_name,
          role: "admin",
          organization_id:
            updateData.organization_id || existingUser.organization_id,
        },
      }
    );

    if (authUpdateError) {
      console.warn(
        `Failed to update auth user email: ${authUpdateError.message}`
      );
    }
  }

  console.log(`✅ Admin user updated successfully: ${adminUserId}`);

  return {
    data: updatedProfile,
    message: "Admin user updated successfully",
  };
}

// Helper function to generate random password
function generateRandomPassword(): string {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

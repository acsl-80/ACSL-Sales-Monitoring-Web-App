// User management utilities for organization admin user creation

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CreateUserData {
  email: string;
  fullName: string;
  organizationId: string;
  role?: string;
}

export interface UserCreationResult {
  userId: string;
  email: string;
  password: string;
  profile: any;
}

export interface EmailApiResponse {
  status: boolean;
  message?: string;
  error?: string;
}

/**
 * Generate a secure random password
 * Contains uppercase, lowercase, numbers, and special characters
 */
export function generateSecurePassword(): string {
  const length = 12;
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";

  // Ensure at least one character from each required set
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const special = "!@#$%^&*";

  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill the rest with random characters
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }

  // Shuffle the password to randomize the order
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * Create a new user in Supabase Auth with profile data
 */
export async function createUserInAuth(
  supabase: any,
  userData: CreateUserData,
  password: string
): Promise<UserCreationResult> {
  console.log(`👤 Creating user in auth for: ${userData.email}`);

  try {
    // Check if email already exists in profiles table
    const { data: existingProfile, error: profileCheckError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", userData.email)
      .single();

    if (existingProfile) {
      throw new Error(
        `User with email "${userData.email}" already exists in profiles`
      );
    }

    // Create user in Supabase Auth using the passed supabase client (should have service role)
    console.log("🔧 Using service role for user creation...");
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: userData.email,
        password: password,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: userData.fullName,
          display_name: userData.fullName,
          role: userData.role || "admin",
          organization_id: userData.organizationId,
        },
      });

    if (authError) {
      console.error("❌ Auth user creation failed:", {
        message: authError.message,
        details: authError,
        code: authError.code,
        status: authError.status,
      });
      throw new Error(`Failed to create user in auth: ${authError.message}`);
    }

    if (!authUser.user) {
      throw new Error("User creation failed - no user data returned");
    }

    console.log(`✅ User created in auth: ${authUser.user.id}`);

    // The profile should be automatically created by the handle_new_user trigger
    // Let's wait a moment and then verify the profile was created
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

    // Fetch the created profile to verify it was created correctly
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.user.id)
      .single();

    if (profileError || !profile) {
      console.warn(
        "Profile was not created automatically, creating manually..."
      );

      // Create profile manually if trigger didn't work
      const { data: newProfile, error: createProfileError } = await supabase
        .from("profiles")
        .insert({
          id: authUser.user.id,
          email: userData.email,
          full_name: userData.fullName,
          role: userData.role || "admin",
          organization_id: userData.organizationId,
          has_changed_password: false, // Admin will need to change password on first login
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createProfileError) {
        throw new Error(
          `Failed to create user profile: ${createProfileError.message}`
        );
      }

      console.log(`✅ Profile created manually: ${newProfile.id}`);

      return {
        userId: authUser.user.id,
        email: userData.email,
        password: password,
        profile: newProfile,
      };
    }

    console.log(`✅ Profile created automatically: ${profile.id}`);

    return {
      userId: authUser.user.id,
      email: userData.email,
      password: password,
      profile: profile,
    };
  } catch (error) {
    console.error("❌ Error creating user:", error);
    throw error;
  }
}

/**
 * Send welcome email via Node.js microservice
 * The microservice handles all email logic internally
 */
export async function sendWelcomeEmail(
  organizationName: string,
  userEmail: string,
  password: string,
  userName: string
): Promise<EmailApiResponse> {
  console.log(`📧 Sending welcome email to: ${userEmail}`);

  const apiUrl =
    (globalThis as any).Deno?.env.get("EMAIL_API_URL") ||
    "https://atmosfair-node-service.vercel.app/api/email-send";

  // Prepare email data for the microservice
  const emailData = {
    email: userEmail,
    user_name: userName,
    organization_name: organizationName,
    password: password,
    type: "welcome-admin", // Email type for the microservice to handle
  };

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailData),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(
        "[manage-organizations] Failed to send email",
        err.error || res.statusText
      );
      return {
        status: false,
        error: `Email API error: ${err.error || res.statusText}`,
      };
    }

    const resp = await res.json().catch(() => ({}));

    if (!resp.success) {
      console.error(
        "[manage-organizations] Email API responded with failure",
        resp
      );
      return {
        status: false,
        error: `Email sending failed: ${resp.message || "Unknown error"}`,
      };
    }

    console.log(`✅ Welcome email sent successfully to: ${userEmail}`);
    return {
      status: true,
      message: "Welcome email sent successfully",
    };
  } catch (error) {
    console.error(
      "[manage-organizations] Error sending email",
      error?.message || error
    );

    // For development/testing, you might want to return success
    // Remove this in production and let the error bubble up
    if ((globalThis as any).Deno?.env.get("ENVIRONMENT") === "development") {
      console.warn("⚠️ Development mode: Simulating email success");
      return { status: true, message: "Email simulated in development mode" };
    }

    return {
      status: false,
      error: error?.message || "Unknown error occurred while sending email",
    };
  }
}

/**
 * Update user email and optionally regenerate password
 */
export async function updateUserInAuth(
  supabase: any,
  userId: string,
  newEmail: string,
  newPassword?: string,
  updateData?: Partial<CreateUserData>
): Promise<{ user: any; profile: any; passwordChanged: boolean }> {
  console.log(`👤 Updating user: ${userId}`);

  try {
    // Prepare update data for auth
    const authUpdateData: any = {
      email: newEmail,
    };

    if (newPassword) {
      authUpdateData.password = newPassword;
    }

    if (updateData) {
      authUpdateData.user_metadata = {
        full_name: updateData.fullName,
        display_name: updateData.fullName,
        role: updateData.role || "admin",
        organization_id: updateData.organizationId,
      };
    }

    // Update user in auth
    const { data: authUser, error: authError } =
      await supabase.auth.admin.updateUserById(userId, authUpdateData);

    if (authError) {
      throw new Error(`Failed to update user in auth: ${authError.message}`);
    }

    // Update profile
    const profileUpdateData: any = {
      email: newEmail,
      updated_at: new Date().toISOString(),
    };

    if (updateData?.fullName) {
      profileUpdateData.full_name = updateData.fullName;
    }

    if (newPassword) {
      profileUpdateData.has_changed_password = false; // User will need to change password on next login
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update(profileUpdateData)
      .eq("id", userId)
      .select()
      .single();

    if (profileError) {
      throw new Error(`Failed to update user profile: ${profileError.message}`);
    }

    console.log(`✅ User updated successfully: ${userId}`);

    return {
      user: authUser.user,
      profile: profile,
      passwordChanged: !!newPassword,
    };
  } catch (error) {
    console.error("❌ Error updating user:", error);
    throw error;
  }
}

/**
 * Disable user account (soft delete)
 */
export async function disableUser(
  supabase: any,
  userId: string
): Promise<void> {
  console.log(`🚫 Disabling user: ${userId}`);

  try {
    // Disable user in auth
    const { error: authError } = await supabase.auth.admin.updateUserById(
      userId,
      { banned_until: "2099-12-31T23:59:59.999Z" } // Effectively permanent ban
    );

    if (authError) {
      throw new Error(`Failed to disable user in auth: ${authError.message}`);
    }

    // Update profile to mark as inactive
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        role: "disabled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) {
      throw new Error(
        `Failed to update profile status: ${profileError.message}`
      );
    }

    console.log(`✅ User disabled successfully: ${userId}`);
  } catch (error) {
    console.error("❌ Error disabling user:", error);
    throw error;
  }
}

/**
 * Find organization admin user
 */
export async function findOrganizationAdmin(
  supabase: any,
  organizationId: string
): Promise<any | null> {
  console.log(`👤 Finding admin user for organization: ${organizationId}`);

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = not found
      throw new Error(`Failed to find organization admin: ${error.message}`);
    }

    return profile || null;
  } catch (error) {
    console.error("❌ Error finding organization admin:", error);
    throw error;
  }
}

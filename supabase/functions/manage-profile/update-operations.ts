// Update operations for manage-profile edge function
import {
  SupabaseClient,
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface UpdateProfileRequest {
  current_password: string; // Required for verification
  new_username?: string;
  new_email?: string;
  new_password?: string;
  new_contact_phone?: string; // New field for contact phone
  new_alternative_phone?: string; // New field for alternative phone
}

/**
 * Update user profile (username, email, and/or password)
 * Can update one, two, or all three fields in a single request
 * Validates uniqueness for username and email
 * Updates auth.users, profiles, and credentials tables
 */
export async function updateUserProfile(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string,
  request: UpdateProfileRequest
): Promise<{
  success: boolean;
  message?: string;
  updated_fields?: string[];
  error?: string;
}> {
  try {
    console.log("\n🔄 ========== STARTING PROFILE UPDATE ==========");
    console.log("👤 User ID:", userId);
    console.log("📧 User Email:", userEmail);
    console.log("\n� INCOMING REQUEST PARAMETERS:");
    console.log("  - current_password:", request.current_password ? "[PROVIDED]" : "[MISSING]");
    console.log("  - new_username:", request.new_username || "[NOT PROVIDED]");
    console.log("  - new_email:", request.new_email || "[NOT PROVIDED]");
    console.log("  - new_password:", request.new_password ? `[PROVIDED - ${request.new_password.length} chars]` : "[NOT PROVIDED]");
    console.log("  - new_contact_phone:", request.new_contact_phone || "[NOT PROVIDED]");
    console.log("  - new_alternative_phone:", request.new_alternative_phone || "[NOT PROVIDED]");
    console.log("📋 Full request object:", JSON.stringify(request, null, 2));

    const {
      current_password,
      new_username,
      new_email,
      new_password,
      new_contact_phone,
      new_alternative_phone,
    } = request;

    console.log("\n📦 DESTRUCTURED VALUES:");
    console.log("  - new_username:", new_username);
    console.log("  - new_email:", new_email);
    console.log("  - new_password:", new_password ? `[${new_password.length} chars]` : "undefined/null");
    console.log("  - new_contact_phone:", new_contact_phone);
    console.log("  - new_alternative_phone:", new_alternative_phone);

    // Validate at least one field is being updated
    if (
      !new_username &&
      !new_email &&
      !new_password &&
      !new_contact_phone &&
      !new_alternative_phone
    ) {
      return {
        success: false,
        error:
          "At least one field (username, email, password, or phone numbers) must be provided for update",
      };
    }

    // Step 1: Verify current password
    console.log("🔐 Verifying current password...");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const verifyClient = createClient(supabaseUrl, supabaseAnonKey);

    const { data: authData, error: authError } =
      await verifyClient.auth.signInWithPassword({
        email: userEmail,
        password: current_password,
      });

    if (authError || !authData.user) {
      console.error("❌ Password verification failed");
      return {
        success: false,
        error: "Current password is incorrect",
      };
    }

    console.log("✅ Password verified");

    const updatedFields: string[] = [];

    // Step 2: Check username uniqueness (if updating username)
    if (new_username && new_username.trim()) {
      console.log("🔍 Checking if username exists:", new_username);

      const { data: existingUsername, error: usernameCheckError } =
        await supabase
          .from("profiles")
          .select("id")
          .eq("username", new_username.trim())
          .neq("id", userId)
          .maybeSingle();

      if (usernameCheckError) {
        console.error("❌ Error checking username:", usernameCheckError);
        return { success: false, error: "Failed to validate username" };
      }

      if (existingUsername) {
        console.error("❌ Username already exists");
        return {
          success: false,
          error: `Username "${new_username}" is already taken`,
        };
      }

      console.log("✅ Username is available");
    }

    // Step 3: Check email uniqueness (if updating email)
    if (new_email && new_email.trim()) {
      console.log("🔍 Checking if email exists:", new_email);

      const { data: existingEmail, error: emailCheckError } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", new_email.trim())
        .neq("id", userId)
        .maybeSingle();

      if (emailCheckError) {
        console.error("❌ Error checking email:", emailCheckError);
        return { success: false, error: "Failed to validate email" };
      }

      if (existingEmail) {
        console.error("❌ Email already exists");
        return {
          success: false,
          error: `Email "${new_email}" is already registered`,
        };
      }

      console.log("✅ Email is available");
    }

    // Step 4: Update auth.users (email and/or password)
    console.log("🔑 Updating auth.users...");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authUpdates: any = {};
    if (new_email && new_email.trim()) {
      authUpdates.email = new_email.trim();
    }
    if (new_password && new_password.trim()) {
      authUpdates.password = new_password.trim();
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: updateAuthError } =
        await adminClient.auth.admin.updateUserById(userId, authUpdates);

      if (updateAuthError) {
        console.error("❌ Failed to update auth.users:", updateAuthError);
        return {
          success: false,
          error: `Failed to update authentication: ${updateAuthError.message}`,
        };
      }

      console.log("✅ auth.users updated successfully");
      if (new_email) updatedFields.push("email");
      if (new_password) updatedFields.push("password");
    }

    // Step 5: Update profiles table
    console.log("💾 Updating profiles table...");
    const profileUpdates: any = {};
    if (new_username && new_username.trim()) {
      profileUpdates.username = new_username.trim();
      updatedFields.push("username");
    }
    if (new_email && new_email.trim()) {
      profileUpdates.email = new_email.trim();
    }
    // ✅ Mark password as changed when user changes their own password
    if (new_password && new_password.trim()) {
      profileUpdates.has_changed_password = true;
      console.log("✅ Marking password as changed by user");
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", userId);

      if (updateProfileError) {
        console.error("❌ Failed to update profiles:", updateProfileError);
        return {
          success: false,
          error: `Failed to update profile: ${updateProfileError.message}`,
        };
      }

      console.log("✅ profiles table updated successfully");
    }

    // Step 6: Update credentials table (if record exists)
    console.log("💾 STEP 6: Checking credentials table for updates...");
    console.log("🔍 User ID for credentials lookup:", userId);
    console.log("🔑 Using service role key for credentials operations (bypass RLS)");
    
    const { data: credential, error: credCheckError } = await adminClient
      .from("credentials")
      .select("id, user_id, username, email, password")
      .eq("user_id", userId)
      .maybeSingle();

    if (credCheckError) {
      console.error("❌ Error checking credentials table:", credCheckError);
    }

    if (credential) {
      console.log("📋 Credential record FOUND!");
      console.log("📋 Current credential record:", {
        id: credential.id,
        user_id: credential.user_id,
        current_username: credential.username,
        current_email: credential.email,
        current_password_length: credential.password ? credential.password.length : 0
      });

      const credUpdates: any = {
        updated_at: new Date().toISOString(),
      };

      console.log("\n🔧 Building credential updates...");
      console.log("🔧 Incoming new_username:", new_username);
      console.log("🔧 Incoming new_email:", new_email);
      console.log("🔧 Incoming new_password:", new_password ? `[${new_password.length} chars]` : "null/undefined");

      if (new_username && new_username.trim()) {
        credUpdates.username = new_username.trim();
        console.log("  ✅ Will update username:", new_username.trim());
      } else {
        console.log("  ❌ Username NOT being updated (value:", new_username, ")");
      }

      if (new_email && new_email.trim()) {
        credUpdates.email = new_email.trim();
        console.log("  ✅ Will update email:", new_email.trim());
      } else {
        console.log("  ❌ Email NOT being updated (value:", new_email, ")");
      }

      if (new_password && new_password.trim()) {
        credUpdates.password = new_password.trim();
        console.log("  ✅ Will update password: [length:", new_password.trim().length, "chars]");
      } else {
        console.log("  ❌ Password NOT being updated (value:", new_password, ")");
      }

      console.log("\n📦 Final credUpdates object:", JSON.stringify(credUpdates, null, 2));
      console.log("📊 Number of keys in credUpdates:", Object.keys(credUpdates).length);

      // Only update if we have fields other than just updated_at
      if (Object.keys(credUpdates).length > 1) {
        console.log("✅ Proceeding with credentials table update...");
        console.log("🔑 Using service role key for credentials update (bypass RLS)");
        
        // IMPORTANT: Use adminClient (service role) to bypass RLS restrictions
        const { error: updateCredError } = await adminClient
          .from("credentials")
          .update(credUpdates)
          .eq("user_id", userId);

        if (updateCredError) {
          console.error("❌ CREDENTIALS UPDATE FAILED!");
          console.error("❌ Error details:", JSON.stringify(updateCredError, null, 2));
          // Don't fail the entire operation if credentials update fails
          console.warn("⚠️ Continuing despite credentials update failure");
        } else {
          console.log("✅ CREDENTIALS TABLE UPDATED SUCCESSFULLY!");
          console.log("✅ Updated fields in credentials:", Object.keys(credUpdates).filter(k => k !== 'updated_at'));
          console.log("✅ New values:", {
            username: credUpdates.username || '[not changed]',
            email: credUpdates.email || '[not changed]',
            password_length: credUpdates.password ? credUpdates.password.length : '[not changed]'
          });
          
          // Verify the update by reading back the record (also use adminClient)
          console.log("🔍 Verifying credentials update...");
          const { data: verifyData, error: verifyError } = await adminClient
            .from("credentials")
            .select("username, email, password")
            .eq("user_id", userId)
            .single();
          
          if (verifyData) {
            console.log("🔍 VERIFICATION - Current credentials record after update:", {
              username: verifyData.username,
              email: verifyData.email,
              password_length: verifyData.password ? verifyData.password.length : 0,
              password_matches: verifyData.password === credUpdates.password ? '✅ YES' : '❌ NO'
            });
          } else if (verifyError) {
            console.warn("⚠️ Could not verify update:", verifyError.message);
          }
        }
      } else {
        console.log("⚠️ NO CREDENTIAL FIELDS TO UPDATE (only updated_at)");
      }
    } else {
      console.log("⚠️ No credential record found for user_id:", userId);
    }

    // Step 7: Update organization table (if user has organization and phone numbers provided)
    if (new_contact_phone || new_alternative_phone) {
      console.log("📞 Checking organization for phone number updates...");

      // Get user's profile to find organization_id
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", userId)
        .single();

      if (userProfile?.organization_id) {
        console.log("🏢 Organization found, updating phone numbers...");
        const orgUpdates: any = {};

        if (new_contact_phone && new_contact_phone.trim()) {
          orgUpdates.contact_phone = new_contact_phone.trim();
          updatedFields.push("contact_phone");
          console.log("  → Updating contact phone in organization");
        }
        if (new_alternative_phone && new_alternative_phone.trim()) {
          orgUpdates.alternative_phone = new_alternative_phone.trim();
          updatedFields.push("alternative_phone");
          console.log("  → Updating alternative phone in organization");
        }

        if (Object.keys(orgUpdates).length > 0) {
          const { error: updateOrgError } = await supabase
            .from("organizations")
            .update(orgUpdates)
            .eq("id", userProfile.organization_id);

          if (updateOrgError) {
            console.error(
              "❌ Failed to update organization:",
              updateOrgError
            );
            // Don't fail the entire operation
            console.warn("⚠️ Continuing despite organization update failure");
          } else {
            console.log("✅ organization table updated successfully");
          }
        }
      } else {
        console.log(
          "ℹ️ User has no organization - skipping phone number update"
        );
      }
    }

    console.log("🎉 Profile update completed!");
    console.log("📊 Updated fields:", updatedFields);

    return {
      success: true,
      message: "Profile updated successfully",
      updated_fields: updatedFields,
    };
  } catch (error) {
    console.error("❌ Unexpected error updating profile:", error);
    return { success: false, error: "Failed to update profile" };
  }
}

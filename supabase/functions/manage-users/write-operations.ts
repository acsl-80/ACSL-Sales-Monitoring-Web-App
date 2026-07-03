// Write operations for users (create and update)

import {
  validateUserData,
  validateUpdateData,
  generateRandomPassword,
} from "./validate.ts";
import {
  creatableRolesFor,
  isManagerRole,
  isPartnerRole,
  userInScope,
  ORG_USER_ROLES,
  CallerContext,
  CallerScope,
} from "./scope.ts";

export async function createUser(
  supabase: any,
  userData: any,
  caller: CallerContext,
  scope: CallerScope
) {
  console.log("➕ Creating new user...");

  try {
    // Validate input data
    const validatedData = validateUserData(userData);
    console.log("✅ User data validated");

    // Enforce caller-based role rules (ACCESS_CONTROL.md User Manager form rules):
    // managers create acsl_agent/partner/partner_agent; partners create partner_agent only.
    if (!creatableRolesFor(caller.role).includes(validatedData.role)) {
      throw new Error(`Unauthorized: You cannot create ${validatedData.role} users`);
    }

    // Partners can only create agents inside their own organization.
    if (isPartnerRole(caller.role)) {
      validatedData.organization_id = caller.organizationId;
      if (!validatedData.organization_id) {
        throw new Error("validation: Your account has no organization to assign agents to");
      }
    }

    // Managers can only bind org-scoped users to partners assigned to them.
    if (
      isManagerRole(caller.role) &&
      ORG_USER_ROLES.includes(validatedData.role) &&
      scope.type === "manager" &&
      (!validatedData.organization_id || !scope.orgIds.includes(validatedData.organization_id))
    ) {
      throw new Error("Unauthorized: Selected partner is not assigned to you");
    }

    // Generate password if needed
    let password = validatedData.password;
    if (validatedData.auto_generate_password) {
      password = generateRandomPassword();
      console.log("🔑 Auto-generated password");
    }

    // Check if email already exists
    const { data: existingUser, error: checkError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", validatedData.email)
      .maybeSingle();

    if (checkError) {
      console.error("❌ Error checking existing user:", checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    // Create user in Supabase Auth
    console.log("👤 Creating user in Supabase Auth...");
    const { data: createdUser, error: createError } =
      await supabase.auth.admin.createUser({
        email: validatedData.email,
        password: password,
        email_confirm: true,
        app_metadata: { role: validatedData.role },
        user_metadata: {
          full_name: validatedData.full_name,
          role: validatedData.role,
        },
      });

    if (createError) {
      console.error("❌ Failed to create user in Auth:", createError);
      throw new Error(`Failed to create user: ${createError.message}`);
    }

    console.log("✅ User created in Auth:", createdUser.user?.id);

    // Wait for profile to be created by trigger
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Explicitly set role + organization_id (trigger may default role).
    // ACSL agents created by a manager report to that manager.
    const profilePatch: any = {
      full_name: validatedData.full_name,
      phone: validatedData.phone,
      role: validatedData.role,
      organization_id: validatedData.organization_id,
    };
    if (isManagerRole(caller.role) && validatedData.role === "acsl_agent") {
      profilePatch.manager_id = caller.id;
    }
    const { error: patchError } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", createdUser.user?.id);
    if (patchError) {
      console.warn("⚠️ Could not finalize profile fields:", patchError.message);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, phone, status, organization_id")
      .eq("id", createdUser.user?.id)
      .single();

    if (profileError) {
      console.error("❌ Profile not created:", profileError);
      // Clean up the auth user if profile creation failed
      await supabase.auth.admin.deleteUser(createdUser.user?.id);
      throw new Error("Failed to create user profile");
    }

    console.log("✅ User created successfully:", profile.id);

    // Save credentials to credentials table so super admin can view them later
    const { error: credError } = await supabase.from("credentials").insert({
      user_id: profile.id,
      profile_id: profile.id,
      email: validatedData.email,
      username: validatedData.email,
      password: password,
      partner_name: validatedData.full_name,
      role: validatedData.role,
      is_dummy_email: false,
      partner_id: null,
      organization_id: validatedData.organization_id,
    });
    if (credError) {
      console.warn("⚠️ Could not save credentials record:", credError.message);
      // Non-fatal — user was created successfully
    } else {
      console.log("✅ Credentials record saved for user:", profile.id);
    }

    return {
      message: "User created successfully",
      data: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        role: profile.role,
        phone: profile.phone,
        status: profile.status,
        password: validatedData.auto_generate_password ? password : undefined,
      },
    };
  } catch (error) {
    console.error("❌ Error in createUser:", error);
    throw error;
  }
}

export async function updateUser(
  supabase: any,
  userId: string,
  updateData: any,
  caller: CallerContext,
  scope: CallerScope
) {
  console.log("✏️ Updating user:", userId);

  try {
    // Validate update data
    const validatedData = validateUpdateData(updateData);
    console.log("✅ Update data validated");

    // Check if the user exists (any role allowed)
    const { data: existingUser, error: checkError } = await supabase
      .from("profiles")
      .select("id, role, email, organization_id, manager_id")
      .eq("id", userId)
      .single();

    if (checkError) {
      if (checkError.code === "PGRST116") {
        throw new Error("User not found");
      }
      console.error("❌ Error checking user:", checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    // Target must be inside the caller's scope (managers: own agents +
    // assigned partners' users; partners: own organization's agents).
    if (!userInScope(scope, existingUser, caller.id)) {
      throw new Error("User not found");
    }

    // A non-super-admin caller's own row is in scope only so read cascades
    // work — self-service edits go through the Profile page, never here.
    if (caller.role !== "super_admin" && userId === caller.id) {
      throw new Error("Unauthorized: You cannot edit your own account from User Management");
    }

    // Non-super-admin callers cannot move users to roles they cannot create,
    // and cannot re-bind users to organizations outside their scope.
    if (caller.role !== "super_admin") {
      if (
        validatedData.role !== undefined &&
        validatedData.role !== existingUser.role &&
        !creatableRolesFor(caller.role).includes(validatedData.role)
      ) {
        throw new Error(`Unauthorized: You cannot assign the ${validatedData.role} role`);
      }
      if (validatedData.organization_id !== undefined && scope.type !== "all") {
        const allowedOrgIds = scope.orgIds;
        if (
          validatedData.organization_id !== null &&
          !allowedOrgIds.includes(validatedData.organization_id)
        ) {
          throw new Error("Unauthorized: Selected partner is not assigned to you");
        }
        // Partners can never detach an agent from their own organization.
        if (isPartnerRole(caller.role)) {
          validatedData.organization_id = caller.organizationId;
        }
      }
    }

    console.log("🔍 User found, proceeding with update");

    // Check if email is being updated and if it conflicts
    if (validatedData.email) {
      const { data: emailConflict, error: emailError } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", validatedData.email)
        .neq("id", userId)
        .maybeSingle();

      if (emailError) {
        console.error("❌ Error checking email conflict:", emailError);
        throw new Error(`Database error: ${emailError.message}`);
      }

      if (emailConflict) {
        throw new Error("Email already exists for another user");
      }
    }

    // Separate password from profile-updatable fields
    const { password: newPassword, ...profileUpdates } = validatedData;

    // Update the profile (only if there are profile-level fields to update)
    let updatedUser: any = existingUser;
    if (Object.keys(profileUpdates).length > 0) {
      const { data: profileRow, error: updateError } = await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", userId)
        .select("id, full_name, email, phone, role, status, created_at")
        .single();

      if (updateError) {
        console.error("❌ Error updating user:", updateError);
        throw new Error(`Database error: ${updateError.message}`);
      }
      updatedUser = profileRow;
    }

    // If email was updated, update it in Auth as well
    if (profileUpdates.email) {
      const { error: authUpdateError } =
        await supabase.auth.admin.updateUserById(userId, {
          email: profileUpdates.email,
        });

      if (authUpdateError) {
        console.warn(
          "⚠️ Failed to update email in Auth:",
          authUpdateError.message
        );
      }
    }

    // If password was provided, update it in Auth
    if (newPassword) {
      const { error: pwError } = await supabase.auth.admin.updateUserById(userId, {
        password: newPassword,
      });
      if (pwError) {
        console.error("❌ Failed to update password:", pwError.message);
        throw new Error(`Failed to update password: ${pwError.message}`);
      }
      console.log("🔑 Password updated for user:", userId);
    }


    console.log("✅ User updated successfully:", updatedUser.id);

    return {
      message: "User updated successfully",
      data: updatedUser,
    };
  } catch (error) {
    console.error("❌ Error in updateUser:", error);
    throw error;
  }
}

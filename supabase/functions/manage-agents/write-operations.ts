// Write operations for agents (create and update)

import { validateAgentData, validateUpdateData } from "./validate.ts";
import { sendEmail } from "../_shared/sendEmail.ts";

function buildWelcomeHtml(agentName: string, agentEmail: string, password: string, appUrl: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;background:#f4f6f8;margin:0;padding:0}
.container{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.header{background:#07376a;padding:32px 40px;text-align:center}.header h1{color:#fff;margin:0;font-size:24px}
.body{padding:32px 40px}.body p{color:#374151;line-height:1.6;margin:0 0 16px}
.cred{background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px;padding:20px;margin:24px 0}
.cred p{margin:8px 0;color:#1e3a5f;font-size:15px}.cred strong{color:#07376a}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:16px 20px;margin:24px 0}
.warn p{margin:0;color:#92400e;font-size:14px}
.steps{padding-left:20px;color:#374151}.steps li{margin-bottom:8px;line-height:1.5}
.footer{background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb}
.footer p{color:#6b7280;font-size:13px;margin:0}
</style></head><body>
<div class="container">
<div class="header"><h1>Welcome to Atmosfair Sales Platform</h1></div>
<div class="body">
<p>Hi <strong>${agentName}</strong>,</p>
<p>Your agent account has been created. Below are your login credentials:</p>
<div class="cred">
<p><strong>Login URL:</strong> ${appUrl}/login</p>
<p><strong>Email:</strong> ${agentEmail}</p>
<p><strong>Temporary Password:</strong> ${password}</p>
</div>
<div class="warn"><p>🔒 <strong>Important:</strong> Change your password immediately after first login.</p></div>
<p>Welcome aboard!<br><strong>Atmosfair Sales Team</strong></p>
</div>
<div class="footer"><p>This is an automated message. Please do not reply.</p></div>
</div></body></html>`;
}

async function sendAgentWelcomeEmail(supabase: any, agentEmail: string, agentName: string, password: string) {
  const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "your platform";
  await sendEmail(supabase, {
    to: agentEmail,
    toName: agentName,
    subject: "Your Atmosfair Agent Account Credentials",
    htmlContent: buildWelcomeHtml(agentName, agentEmail, password, appUrl),
    notificationKey: "agent_created",
    isAutomatic: true,
  });
}

export async function createAgent(
  supabase: any,
  agentData: any,
  adminId: string,
  userRole: string,
  organizationId: string | null
) {
  console.log("➕ Creating new agent...");

  try {
    // Validate input data
    const validatedData = validateAgentData(agentData);
    console.log("✅ Agent data validated");

    // Determine organization for the new agent
    let targetOrganizationId = organizationId;

    if (userRole === "super_admin" && agentData.organization_id) {
      // Super admin can specify organization
      targetOrganizationId = agentData.organization_id;
      console.log(
        "🏢 Super admin specified organization:",
        targetOrganizationId
      );
    } else if (userRole === "partner" || userRole === "admin") {
      // Partner (formerly admin) creates agents in their own organization
      if (!organizationId) {
        throw new Error("Admin must have an organization to create agents");
      }
      targetOrganizationId = organizationId;
      console.log(
        "🏢 Admin creating agent in their organization:",
        targetOrganizationId
      );
    } else {
      throw new Error("Insufficient permissions to create agents");
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
        password: validatedData.password,
        email_confirm: true,
        user_metadata: {
          full_name: validatedData.full_name,
          role: "partner_agent",
          organization_id: targetOrganizationId,
        },
      });

    if (createError) {
      console.error("❌ Failed to create user in Auth:", createError);
      throw new Error(`Failed to create user: ${createError.message}`);
    }

    console.log("✅ User created in Auth:", createdUser.user?.id);

    // The profile should be created automatically by the database trigger
    // Wait a moment and then fetch the profile to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, organization_id")
      .eq("id", createdUser.user?.id)
      .single();

    if (profileError) {
      console.error("❌ Profile not created:", profileError);
      // Clean up the auth user if profile creation failed
      await supabase.auth.admin.deleteUser(createdUser.user?.id);
      throw new Error("Failed to create agent profile");
    }

    // Update phone on profile (trigger may not set it)
    if (validatedData.phone) {
      const { error: phoneUpdateError } = await supabase
        .from("profiles")
        .update({ phone: validatedData.phone })
        .eq("id", createdUser.user?.id);

      if (phoneUpdateError) {
        console.warn("⚠️ Could not save phone to profile:", phoneUpdateError.message);
      }
    }

    console.log("✅ Agent created successfully:", profile.id);

    // Store credentials so they can be retrieved later via manage-credentials
    await supabase.from("credentials").insert({
      user_id: profile.id,
      profile_id: profile.id,
      email: validatedData.email,
      username: validatedData.email,
      password: validatedData.password,
      partner_name: validatedData.full_name,
      role: profile.role ?? "partner_agent",
      is_dummy_email: false,
      partner_id: null,
      organization_id: targetOrganizationId ?? null,
    });

    // Send welcome email with credentials (non-blocking)
    await sendAgentWelcomeEmail(
      supabase,
      validatedData.email,
      validatedData.full_name,
      validatedData.password
    );

    return {
      message: "Agent created successfully",
      data: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        role: profile.role,
        organization_id: profile.organization_id,
      },
    };
  } catch (error) {
    console.error("❌ Error in createAgent:", error);
    throw error;
  }
}

export async function updateAgent(
  supabase: any,
  agentId: string,
  updateData: any,
  adminId: string,
  userRole: string,
  organizationId: string | null
) {
  console.log("✏️ Updating agent:", agentId);

  try {
    // Validate update data
    const validatedData = validateUpdateData(updateData);
    console.log("✅ Update data validated");

    // First, check if the agent exists and admin has permission to update
    let checkQuery = supabase
      .from("profiles")
      .select("id, organization_id, role")
      .eq("id", agentId)
      .in("role", ["partner_agent", "agent"]);

    // Apply organization filter for partner (formerly admin) users
    if ((userRole === "partner" || userRole === "admin") && organizationId) {
      checkQuery = checkQuery.eq("organization_id", organizationId);
    } else if (userRole !== "super_admin") {
      throw new Error("Insufficient permissions to update agents");
    }

    const { data: existingAgent, error: checkError } =
      await checkQuery.single();

    if (checkError) {
      if (checkError.code === "PGRST116") {
        throw new Error("Agent not found or access denied");
      }
      console.error("❌ Error checking agent:", checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    console.log("🔍 Agent found, proceeding with update");

    // Check if email is being updated and if it conflicts
    if (validatedData.email) {
      const { data: emailConflict, error: emailError } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", validatedData.email)
        .neq("id", agentId)
        .maybeSingle();

      if (emailError) {
        console.error("❌ Error checking email conflict:", emailError);
        throw new Error(`Database error: ${emailError.message}`);
      }

      if (emailConflict) {
        throw new Error("Email already exists for another user");
      }
    }

    // Update the profile
    const { data: updatedAgent, error: updateError } = await supabase
      .from("profiles")
      .update(validatedData)
      .eq("id", agentId)
      .select("id, full_name, email, phone, role, organization_id, created_at")
      .single();

    if (updateError) {
      console.error("❌ Error updating agent:", updateError);
      throw new Error(`Database error: ${updateError.message}`);
    }

    // If email was updated, update it in Auth as well
    if (validatedData.email) {
      const { error: authUpdateError } =
        await supabase.auth.admin.updateUserById(agentId, {
          email: validatedData.email,
        });

      if (authUpdateError) {
        console.warn(
          "⚠️ Failed to update email in Auth:",
          authUpdateError.message
        );
        // Don't fail the whole operation, just log the warning
      }
    }

    console.log("✅ Agent updated successfully:", updatedAgent.id);

    return {
      message: "Agent updated successfully",
      data: updatedAgent,
    };
  } catch (error) {
    console.error("❌ Error in updateAgent:", error);
    throw error;
  }
}

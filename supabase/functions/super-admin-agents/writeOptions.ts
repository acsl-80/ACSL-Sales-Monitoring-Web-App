// Write operations for super-admin-agents (ACSL Agent create and update)

import { sendEmail } from "../_shared/sendEmail.ts";

export async function createAgent(supabase: any, data: any, adminId: string, managerId: string | null = null) {
  console.log("➕ Creating new ACSL agent...");

  // Validate required fields
  if (!data.full_name?.trim()) throw new Error("validation: full_name is required");
  if (!data.email?.trim()) throw new Error("validation: email is required");
  if (!data.password?.trim() || data.password.length < 8) {
    throw new Error("validation: password must be at least 8 characters");
  }

  const email = data.email.trim().toLowerCase();
  // Accept both old and new role values; default to acsl_agent
  const mappedRole = data.role === "super_admin_agent" ? "acsl_agent" : data.role;
  // acsl_agent_manager can only create acsl_agent accounts (not super_admin)
  const allowedRoles = managerId ? ["acsl_agent"] : ["acsl_agent", "super_admin", "acsl_agent_manager"];
  const role = allowedRoles.includes(mappedRole) ? mappedRole : "acsl_agent";

  // Check if email already exists
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) throw new Error("User with this email already exists");

  // Create user in Supabase Auth
  console.log("👤 Creating user in Supabase Auth...");
  const { data: createdUser, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: {
        full_name: data.full_name.trim(),
        role,
      },
    });

  if (createError) {
    throw new Error(`Failed to create user: ${createError.message}`);
  }

  console.log("✅ User created in Auth:", createdUser.user?.id);

  // Wait for profile trigger
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Fetch the auto-created profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, status, created_at")
    .eq("id", createdUser.user?.id)
    .single();

  if (profileError) {
    // Clean up auth user if profile was not created
    await supabase.auth.admin.deleteUser(createdUser.user?.id);
    throw new Error("Failed to create user profile");
  }

  // Update profile with phone, stamp manager_id (if created by a manager), and ensure organization_id stays NULL
  await supabase
    .from("profiles")
    .update({
      ...(data.phone ? { phone: data.phone } : {}),
      ...(managerId ? { manager_id: managerId } : {}),
      organization_id: null,
      updated_by: adminId,
    })
    .eq("id", profile.id);

  // Save credentials so they appear in the credentials management page
  await supabase.from("credentials").insert({
    user_id: profile.id,
    profile_id: profile.id,
    email,
    username: email,
    password: data.password,
    partner_name: data.full_name.trim(),
    role,
    is_dummy_email: false,
    partner_id: null,
    organization_id: null,
  });

  console.log("✅ ACSL agent created successfully:", profile.id);

  // Send welcome email with credentials (non-blocking)
  sendWelcomeEmail(supabase, email, data.full_name.trim(), data.password).catch(() => {});

  return {
    message: "ACSL agent created successfully",
    data: { ...profile, phone: data.phone || profile.phone },
  };
}

async function sendWelcomeEmail(supabase: any, userEmail: string, userName: string, password: string) {
  const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "your platform";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;background:#f4f6f8;margin:0;padding:0}
.container{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.header{background:#07376a;padding:32px 40px;text-align:center}.header h1{color:#fff;margin:0;font-size:24px}
.body{padding:32px 40px}.body p{color:#374151;line-height:1.6;margin:0 0 16px}
.cred{background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px;padding:20px;margin:24px 0}
.cred p{margin:8px 0;color:#1e3a5f;font-size:15px}.cred strong{color:#07376a}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:16px 20px;margin:24px 0}
.warn p{margin:0;color:#92400e;font-size:14px}
.footer{background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb}
.footer p{color:#6b7280;font-size:13px;margin:0}
</style></head><body>
<div class="container">
<div class="header"><h1>Welcome to Atmosfair Sales Platform</h1></div>
<div class="body">
<p>Hi <strong>${userName}</strong>,</p>
<p>Your account has been created. Here are your login credentials:</p>
<div class="cred">
<p><strong>Login URL:</strong> ${appUrl}/login</p>
<p><strong>Email:</strong> ${userEmail}</p>
<p><strong>Temporary Password:</strong> ${password}</p>
</div>
<div class="warn"><p>🔒 <strong>Important:</strong> Please change your password after your first login.</p></div>
<p>Welcome aboard!<br><strong>Atmosfair Sales Team</strong></p>
</div>
<div class="footer"><p>This is an automated message. Please do not reply.</p></div>
</div></body></html>`;

  await sendEmail(supabase, {
    to: userEmail,
    toName: userName,
    subject: "Your Atmosfair Account Credentials",
    htmlContent: html,
    notificationKey: "agent_created",
    isAutomatic: true,
  });
}

export async function updateAgent(supabase: any, agentId: string, data: any, adminId: string, managerScopeId: string | null = null) {
  console.log("✏️ Updating agent:", agentId);

  // Verify agent exists; managers may only update their own agents
  let checkQuery = supabase
    .from("profiles")
    .select("id")
    .eq("id", agentId)
    .in("role", ["acsl_agent", "acsl_agent_manager", "super_admin"]);

  if (managerScopeId) checkQuery = checkQuery.eq("manager_id", managerScopeId);

  const { data: existing, error: checkError } = await checkQuery.single();

  if (checkError) {
    if (checkError.code === "PGRST116") throw new Error("Agent not found");
    throw new Error(`Database error: ${checkError.message}`);
  }

  // Build update payload (only allowed fields)
  const updates: Record<string, any> = {};
  if (data.full_name?.trim()) updates.full_name = data.full_name.trim();
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.status && ["active", "disabled"].includes(data.status)) {
    updates.status = data.status;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("validation: No valid fields to update");
  }

  // Stamp who made the change and when (only on intentional admin edits)
  updates.updated_at = new Date().toISOString();
  updates.updated_by = adminId;

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", agentId)
    .select("id, full_name, email, phone, role, status, created_at, last_login, updated_at, updated_by")
    .single();

  if (updateError) throw new Error(`Database error: ${updateError.message}`);

  // If status is being disabled, also disable in auth
  if (updates.status === "disabled") {
    await supabase.auth.admin.updateUserById(agentId, { ban_duration: "87600h" });
  } else if (updates.status === "active") {
    await supabase.auth.admin.updateUserById(agentId, { ban_duration: "none" });
  }

  // Resolve the admin's name for the response
  const { data: updater } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", adminId)
    .single();

  console.log("✅ Agent updated:", agentId);

  return {
    message: "Agent updated successfully",
    data: { ...updated, updated_by_name: updater?.full_name || updater?.email || null },
  };
}

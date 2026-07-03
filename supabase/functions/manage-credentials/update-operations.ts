// Update operations for credentials management
import {
  SupabaseClient,
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface UpdatePasswordRequest {
  partner_id: string;
  new_password: string;
  super_admin_password: string;
  super_admin_email: string;
}

/**
 * Update password for an organization (Super Admin only with password verification)
 * Updates both credentials table and auth.users
 */
export async function updateOrganizationPassword(
  supabase: SupabaseClient,
  request: UpdatePasswordRequest
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const {
      partner_id,
      new_password,
      super_admin_password,
      super_admin_email,
    } = request;

    // Step 1: Verify Super Admin's password
    console.log("🔐 Verifying Super Admin password...");

    // Create a separate client for password verification
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const verifyClient = createClient(supabaseUrl, supabaseAnonKey);

    const { data: authData, error: authError } =
      await verifyClient.auth.signInWithPassword({
        email: super_admin_email,
        password: super_admin_password,
      });

    if (authError || !authData.user) {
      console.error("❌ Super Admin password verification failed");
      return {
        success: false,
        error: "Invalid Super Admin password. Authorization denied.",
      };
    }

    console.log("✅ Super Admin password verified");

    // Step 2: Get credential record by partner_id
    console.log(`📋 Fetching credential for partner: ${partner_id}`);
    const { data: credential, error: credError } = await supabase
      .from("credentials")
      .select("*")
      .eq("partner_id", partner_id)
      .single();

    if (credError || !credential) {
      console.error("❌ Credential not found");
      return { success: false, error: "Credential not found for this partner" };
    }

    console.log(`✅ Credential found for user: ${credential.email}`);

    // Step 3: Update password in auth.users using service role
    console.log("🔑 Updating password in auth.users...");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { error: updateAuthError } =
      await adminClient.auth.admin.updateUserById(credential.user_id, {
        password: new_password,
      });

    if (updateAuthError) {
      console.error("❌ Failed to update auth password:", updateAuthError);
      return {
        success: false,
        error: `Failed to update authentication password: ${updateAuthError.message}`,
      };
    }

    console.log("✅ Auth password updated successfully");

    // Step 4: Update password in credentials table (use service role to bypass RLS)
    console.log("💾 Updating password in credentials table...");
    const { error: updateCredError } = await adminClient
      .from("credentials")
      .update({
        password: new_password,
        updated_at: new Date().toISOString(),
      })
      .eq("partner_id", partner_id);

    if (updateCredError) {
      console.error("❌ Failed to update credential:", updateCredError);
      return {
        success: false,
        error: `Failed to update credential record: ${updateCredError.message}`,
      };
    }

    console.log("✅ Credential updated successfully");

    return {
      success: true,
      message: `Password successfully updated for organization: ${credential.partner_name}`,
    };
  } catch (error) {
    console.error("❌ Unexpected error updating password:", error);
    return { success: false, error: "Failed to update password" };
  }
}

/**
 * Generate a secure random password
 */
export function generateSecurePassword(length: number = 16): string {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => charset[byte % charset.length]).join("");
}

/**
 * Reset password for an organization (Auto-generates password OR use custom)
 * Super Admin only - requires password verification
 */
export async function resetOrganizationPassword(
  supabase: SupabaseClient,
  partnerId: string,
  superAdminEmail: string,
  superAdminPassword: string,
  customPassword?: string // Optional: If provided, use this instead of auto-generating
): Promise<{
  success: boolean;
  message?: string;
  newPassword?: string;
  error?: string;
}> {
  try {
    console.log("🔄 Starting password reset process...");
    console.log(`📋 Partner ID: ${partnerId}`);
    console.log(`👤 Super Admin: ${superAdminEmail}`);
    console.log(
      `🔑 Password mode: ${customPassword ? "Custom" : "Auto-generated"}`
    );

    // Step 1: Verify Super Admin's password
    console.log("🔐 Verifying Super Admin password...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const verifyClient = createClient(supabaseUrl, supabaseAnonKey);

    const { data: authData, error: authError } =
      await verifyClient.auth.signInWithPassword({
        email: superAdminEmail,
        password: superAdminPassword,
      });

    if (authError || !authData.user) {
      console.error("❌ Super Admin password verification failed");
      return {
        success: false,
        error: "Invalid Super Admin password",
      };
    }

    console.log("✅ Super Admin password verified");

    // Step 2: Get credential record by partner_id
    console.log(`📋 Fetching credential for partner: ${partnerId}`);
    const { data: credential, error: credError } = await supabase
      .from("credentials")
      .select("*")
      .eq("partner_id", partnerId)
      .single();

    if (credError || !credential) {
      console.error("❌ Credential not found");
      return {
        success: false,
        error: `Partner not found with ID: ${partnerId}`,
      };
    }

    console.log(`✅ Credential found for user: ${credential.email}`);

    // Step 3: Use custom password OR auto-generate new secure password
    let newPassword: string;
    if (customPassword && customPassword.trim().length > 0) {
      newPassword = customPassword.trim();
      console.log("🔑 Using custom password provided by Super Admin");

      // Validate custom password strength (minimum 8 characters)
      if (newPassword.length < 8) {
        return {
          success: false,
          error: "Custom password must be at least 8 characters long",
        };
      }
    } else {
      newPassword = generateSecurePassword(16);
      console.log("🔑 Auto-generated new secure password (length: 16)");
    }

    // Step 4: Update password in auth.users using service role
    console.log("🔑 Updating password in auth.users...");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { error: updateAuthError } =
      await adminClient.auth.admin.updateUserById(credential.user_id, {
        password: newPassword,
      });

    if (updateAuthError) {
      console.error("❌ Failed to update auth password:", updateAuthError);
      return {
        success: false,
        error: `Failed to update authentication password: ${updateAuthError.message}`,
      };
    }

    console.log("✅ Auth password updated successfully");

    // Step 5: Update password in credentials table (use service role to bypass RLS)
    console.log("💾 Updating password in credentials table...");
    const { error: updateCredError } = await adminClient
      .from("credentials")
      .update({
        password: newPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("partner_id", partnerId);

    if (updateCredError) {
      console.error("❌ Failed to update credential:", updateCredError);
      return {
        success: false,
        error: `Failed to update credential record: ${updateCredError.message}`,
      };
    }

    console.log("✅ Credential updated successfully");

    // Step 6: Reset has_changed_password to false in profiles table
    // When Super Admin resets password, user must change it on next login
    console.log("💾 Resetting has_changed_password flag in profiles table...");
    const { error: updateProfileError } = await supabase
      .from("profiles")
      .update({
        has_changed_password: false,
      })
      .eq("id", credential.user_id);

    if (updateProfileError) {
      console.warn("⚠️ Failed to update has_changed_password:", updateProfileError);
      // Don't fail the entire operation if this update fails
    } else {
      console.log("✅ has_changed_password reset to false (user must change password)");
    }

    console.log("🎉 Password reset completed!");

    return {
      success: true,
      message: `Password reset successfully for partner: ${partnerId}`,
      newPassword: newPassword,
    };
  } catch (error) {
    console.error("❌ Unexpected error resetting password:", error);
    return { success: false, error: "Failed to reset password" };
  }
}

import { sendEmail } from "../_shared/sendEmail.ts";

async function sendPasswordResetEmail(supabase: any, userEmail: string, userName: string, newPassword: string) {
  const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "your platform";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;background:#f4f6f8;margin:0;padding:0}
.container{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.header{background:#07376a;padding:32px 40px;text-align:center}.header h1{color:#fff;margin:0;font-size:22px}
.body{padding:32px 40px}.body p{color:#374151;line-height:1.6;margin:0 0 16px}
.cred{background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px;padding:20px;margin:24px 0}
.cred p{margin:8px 0;color:#1e3a5f;font-size:15px}.cred strong{color:#07376a}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:16px 20px;margin:24px 0}
.warn p{margin:0;color:#92400e;font-size:14px}
.footer{background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb}
.footer p{color:#6b7280;font-size:13px;margin:0}
</style></head><body>
<div class="container">
<div class="header"><h1>Password Reset — Atmosfair Sales Platform</h1></div>
<div class="body">
<p>Hi <strong>${userName}</strong>,</p>
<p>Your account password has been reset by an administrator. Your new login credentials are:</p>
<div class="cred">
<p><strong>Login URL:</strong> ${appUrl}/login</p>
<p><strong>Email:</strong> ${userEmail}</p>
<p><strong>New Password:</strong> ${newPassword}</p>
</div>
<div class="warn"><p>🔒 <strong>Important:</strong> If you did not request this change, contact your administrator immediately.</p></div>
<p>Atmosfair Sales Team</p>
</div>
<div class="footer"><p>This is an automated message. Please do not reply.</p></div>
</div></body></html>`;

  await sendEmail(supabase, {
    to: userEmail,
    toName: userName,
    subject: "Your Atmosfair Password Has Been Reset",
    htmlContent: html,
    notificationKey: "password_reset",
    isAutomatic: true,
  });
}

/**
 * Reset password for an agent/manager by user_id (no super admin password verification required —
 * caller must already be authenticated as super_admin or acsl_agent_manager)
 */
export async function resetAgentPassword(
  supabase: any,
  userId: string,
  newPassword: string
): Promise<{ success: boolean; message?: string; newPassword?: string; error?: string }> {
  try {
    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: "Password must be at least 8 characters" };
    }

    // Fetch credential record
    const { data: credential, error: credError } = await supabase
      .from("credentials")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (credError || !credential) {
      return { success: false, error: "Credential record not found for this user" };
    }

    // Update auth.users password
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.3");
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateAuthError) {
      return { success: false, error: `Failed to update password: ${updateAuthError.message}` };
    }

    // Update credentials table
    await supabase
      .from("credentials")
      .update({ password: newPassword, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    // Send email non-blocking
    sendPasswordResetEmail(supabase, credential.email, credential.partner_name || credential.username, newPassword);

    return { success: true, message: "Password reset successfully", newPassword };
  } catch (error) {
    console.error("❌ Unexpected error resetting agent password:", error);
    return { success: false, error: "Failed to reset password" };
  }
}

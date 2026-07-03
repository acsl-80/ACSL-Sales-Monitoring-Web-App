import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

interface ExternalSyncRequest {
  token: string;
  secret_key: string;
  application_name: string;
  organization_data: {
    partner_id: string;
    partner_name: string;
    partner_type?: "partner" | "customer";
    email?: string;
    contact_person?: string;
    contact_phone?: string;
    alternative_phone?: string;
    address?: string;
    state?: string;
    branch?: string;
  };
  stove_ids?: Array<{ stove_id: string; factory: string; sales_reference?: string }> | string[];
  sales_date?: string;
  origin_url?: string;
}

interface TokenValidationResult {
  isValid: boolean;
  token_data?: any;
  error?: string;
}

interface StoveIdResult {
  stove_id: string;
  factory?: string;
  sales_reference?: string;
  action: "created" | "already_exists";
}

interface UserCreationResult {
  userId: string;
  email: string;
  username?: string;
  password: string;
  isDummyEmail: boolean;
  isInternalEmail: boolean;
}

// ─── Log helpers ────────────────────────────────────────────────────────────

interface LogEntry {
  step: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  detail?: any;
  ts: string;
}

function mkEntry(
  step: string,
  level: LogEntry["level"],
  message: string,
  detail?: any,
): LogEntry {
  return { step, level, message, detail, ts: new Date().toISOString() };
}

// ─── Utility functions ───────────────────────────────────────────────────────

function isValidEmail(email: string | undefined | null): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();
  const invalidValues = ["", "n/a", "na", "null", "undefined", "none", "-", "nil", "n.a"];
  if (invalidValues.includes(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function generatePassword(): string {
  const length = 12;
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) password += charset[array[i] % charset.length];
  return password;
}

function generateUsername(partnerName: string, partnerId: string): string {
  const words = partnerName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  let namePrefix = words[0] || "user";
  if (namePrefix.length > 8) namePrefix = namePrefix.substring(0, 8);
  const cleanId = partnerId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${cleanId}_${namePrefix}`;
}

function normalizeBranch(branch: string | undefined): string {
  if (!branch) return "Main Branch";
  const trimmed = branch.trim();
  const normalized = trimmed.toUpperCase();
  if (["NA", "N/A", "N.A.", "NOT AVAILABLE"].includes(normalized)) return "Main Branch";
  return trimmed;
}

function generateInternalEmail(username: string): string {
  return `${username}@internal.acsl.local`;
}

// ─── User creation ────────────────────────────────────────────────────────────

async function createUserForOrganization(
  supabase: any,
  email: string,
  username: string | undefined,
  password: string,
  partnerName: string,
  organizationId: string,
  isInternalEmail: boolean,
  entries: LogEntry[],
): Promise<UserCreationResult> {
  entries.push(mkEntry("create-user", "info", `Creating user — email: ${email.substring(0, 10)}..., username: ${username}`));

  const { data: existingAuthUsers } = await supabase.auth.admin.listUsers();
  let authUserId: string | null = null;

  if (existingAuthUsers?.users) {
    const existingUser = existingAuthUsers.users.find((u: any) => u.email === email);
    if (existingUser) {
      entries.push(mkEntry("create-user", "warn", `Auth user already exists (ID: ${existingUser.id}), reusing`));
      authUserId = existingUser.id;
    }
  }

  if (!authUserId) {
    const { data: newAuthUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: partnerName, display_name: partnerName, role: "admin", organization_id: organizationId, username },
    });
    if (authError) throw new Error(`Auth user creation failed: ${authError.message}`);
    if (!newAuthUser.user) throw new Error("User creation returned no user data");
    authUserId = newAuthUser.user.id;
    entries.push(mkEntry("create-user", "success", `New auth user created (ID: ${authUserId})`));
  }

  // Check/update profile
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUserId)
    .maybeSingle();

  if (existingProfile) {
    entries.push(mkEntry("create-user", "warn", `Profile already exists, updating username/role`));
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ username, role: "admin" })
      .eq("id", authUserId);
    if (updateError) {
      entries.push(mkEntry("create-user", "error", `Profile update failed: ${updateError.message}`));
    } else {
      entries.push(mkEntry("create-user", "success", `Profile updated successfully`));
    }
    return { userId: authUserId!, email, username, password, isDummyEmail: email.endsWith("@atmosfair.site"), isInternalEmail };
  }

  // Create profile
  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUserId,
    email,
    username,
    full_name: partnerName,
    role: "admin",
    organization_id: organizationId,
    has_changed_password: false,
    created_at: new Date().toISOString(),
  });

  if (profileError) {
    entries.push(mkEntry("create-user", "error", `Profile creation failed: ${profileError.message}`));
    if (!existingAuthUsers?.users?.find((u: any) => u.id === authUserId)) {
      await supabase.auth.admin.deleteUser(authUserId);
    }
    throw new Error(`Profile creation failed: ${profileError.message}`);
  }

  entries.push(mkEntry("create-user", "success", `Profile created successfully`));
  return { userId: authUserId!, email, username, password, isDummyEmail: email.endsWith("@atmosfair.site"), isInternalEmail };
}

async function saveCredentials(
  supabase: any,
  partnerId: string,
  partnerName: string,
  email: string,
  username: string | undefined,
  password: string,
  organizationId: string,
  userId: string,
  isDummyEmail: boolean,
  isInternalEmail: boolean,
  entries: LogEntry[],
): Promise<void> {
  const { error } = await supabase.from("credentials").insert({
    partner_id: partnerId,
    partner_name: partnerName,
    email,
    username,
    password,
    organization_id: organizationId,
    user_id: userId,
    profile_id: userId,
    role: "admin",
    is_dummy_email: isDummyEmail,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) {
    entries.push(mkEntry("save-credentials", "error", `Failed to save credentials: ${error.message}`));
    throw new Error(`Failed to save credentials: ${error.message}`);
  }
  entries.push(mkEntry("save-credentials", "success", `Credentials saved for partner ${partnerId}`));
}

// ─── Transfer history ─────────────────────────────────────────────────────────

async function writeTransferHistory(
  supabase: any,
  data: {
    organization_id: string;
    partner_name: string;
    partner_id: string;
    state?: string;
    branch?: string;
    sales_factory?: string;
    sales_date?: string | null;
    customer?: string | null;
    downloaded_by?: string | null;
    sales_rep?: string | null;
    stove_ids: Array<{ stove_id: string; factory?: string; sales_reference?: string }>;
    source: "external-sync" | "external-csv-sync";
    application_name?: string;
  },
): Promise<void> {
  if (data.stove_ids.length === 0) return;
  try {
    const salesRef = data.stove_ids.find((s) => s.sales_reference)?.sales_reference;
    const transactionId = salesRef || `TRF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await supabase.from("stove_transfer_history").insert({
      transaction_id: transactionId,
      organization_id: data.organization_id,
      partner_name: data.partner_name,
      partner_id: data.partner_id,
      state: data.state || null,
      branch: data.branch || null,
      sales_factory: data.sales_factory || null,
      sales_date: data.sales_date || null,
      customer: data.customer || null,
      downloaded_by: data.downloaded_by || null,
      sales_rep: data.sales_rep || null,
      stove_count: data.stove_ids.length,
      stove_ids: data.stove_ids,
      source: data.source,
      application_name: data.application_name || null,
      transfer_date: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to write transfer history:", e);
  }
}

// ─── DB logging ───────────────────────────────────────────────────────────────

async function writeSyncLog(
  supabase: any,
  logData: {
    source: "external-sync" | "external-csv-sync";
    status: "success" | "partial" | "failed";
    application_name: string | undefined;
    started_at: string;
    duration_ms: number;
    total_partners: number;
    partners_created: number;
    partners_updated: number;
    partners_failed: number;
    total_stove_ids: number;
    stove_ids_created: number;
    stove_ids_skipped: number;
    entries: LogEntry[];
    request_summary: any;
    error_message?: string;
  },
): Promise<void> {
  try {
    await supabase.from("sync_logs").insert({
      ...logData,
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to write sync log:", e);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));

  if (req.method !== "POST") {
    return withCors(
      new Response(JSON.stringify({ success: false, message: "Method not allowed. Only POST requests are accepted." }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // No JWT check — this endpoint is intentionally public (token/secret_key based auth)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let body: ExternalSyncRequest;
  try {
    body = await req.json();
  } catch {
    return withCors(
      new Response(JSON.stringify({ success: false, message: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const entries: LogEntry[] = [];

  // ── Auth: accept either Supabase JWT (internal/super_admin) or token+secret_key (external) ──
  const authHeader = req.headers.get("Authorization") || "";
  const jwtToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let isInternalAuth = false;

  if (jwtToken) {
    // Validate JWT — must be a super_admin
    const { data: { user }, error: jwtError } = await supabase.auth.getUser(jwtToken);
    if (jwtError || !user) {
      return withCors(new Response(JSON.stringify({ success: false, message: "Invalid session token" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "super_admin") {
      return withCors(new Response(JSON.stringify({ success: false, message: "Insufficient permissions — super_admin required" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    isInternalAuth = true;
    body.application_name = body.application_name || "internal-dashboard";
  }

  entries.push(mkEntry("request", "info", `Request received from application: ${body.application_name}`, {
    partner_id: body.organization_data?.partner_id,
    partner_name: body.organization_data?.partner_name,
    stove_ids_count: body.stove_ids?.length ?? 0,
    origin_url: body.origin_url,
    auth_mode: isInternalAuth ? "jwt" : "token",
  }));

  // Validate required fields
  if (!isInternalAuth && (!body.token || !body.secret_key || !body.application_name || !body.organization_data)) {
    const msg = "Missing required fields: token, secret_key, application_name, and organization_data are required";
    await writeSyncLog(supabase, {
      source: "external-sync",
      status: "failed",
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 0, partners_created: 0, partners_updated: 0, partners_failed: 1,
      total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
      entries: [...entries, mkEntry("validation", "error", msg)],
      request_summary: { application_name: body.application_name },
      error_message: msg,
    });
    return withCors(new Response(JSON.stringify({ success: false, message: msg }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  if (!body.organization_data || !body.organization_data.partner_id || !body.organization_data.partner_name) {
    const msg = "partner_id and partner_name are required in organization_data";
    await writeSyncLog(supabase, {
      source: "external-sync",
      status: "failed",
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 1, partners_created: 0, partners_updated: 0, partners_failed: 1,
      total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
      entries: [...entries, mkEntry("validation", "error", msg)],
      request_summary: { application_name: body.application_name, partner_id: body.organization_data?.partner_id },
      error_message: msg,
    });
    return withCors(new Response(JSON.stringify({ success: false, message: msg }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  // Validate token (external only)
  if (!isInternalAuth) {
    const tokenValidation = await validateExternalToken(supabase, body.token, body.secret_key, body.application_name, body.origin_url);
    if (!tokenValidation.isValid) {
      const msg = tokenValidation.error || "Invalid authentication credentials";
      entries.push(mkEntry("token-validation", "error", msg));
      await writeSyncLog(supabase, {
        source: "external-sync",
        status: "failed",
        application_name: body.application_name,
        started_at: startedAt,
        duration_ms: Date.now() - startMs,
        total_partners: 1, partners_created: 0, partners_updated: 0, partners_failed: 1,
        total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
        entries,
        request_summary: { application_name: body.application_name },
        error_message: msg,
      });
      return withCors(new Response(JSON.stringify({ success: false, message: msg }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }
  }

  entries.push(mkEntry("token-validation", "success", isInternalAuth ? "Internal JWT auth passed" : "Token validated successfully"));

  try {
    const syncResult = await processOrganizationSync(supabase, body.organization_data, body.stove_ids || [], entries, body.sales_date || null);

    if (!isInternalAuth) await updateTokenUsage(supabase, body.token);

    // Write transfer history for newly created stove IDs
    const newStoves = syncResult.stove_ids.filter((s: any) => s.action === "created");
    if (newStoves.length > 0) {
      await writeTransferHistory(supabase, {
        organization_id: syncResult.organization.id,
        partner_name: body.organization_data.partner_name,
        partner_id: body.organization_data.partner_id,
        state: body.organization_data.state,
        branch: body.organization_data.branch,
        sales_factory: newStoves[0]?.factory || undefined,
        sales_date: body.sales_date || null,
        stove_ids: newStoves.map((s: any) => ({ stove_id: s.stove_id, factory: s.factory, sales_reference: s.sales_reference })),
        source: "external-sync",
        application_name: body.application_name,
      });
    }

    const orgAction = syncResult.summary.organization_action as string;
    const status: "success" | "partial" = "success";

    await writeSyncLog(supabase, {
      source: "external-sync",
      status,
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 1,
      partners_created: orgAction === "created" ? 1 : 0,
      partners_updated: orgAction === "updated" ? 1 : 0,
      partners_failed: 0,
      total_stove_ids: syncResult.summary.stove_ids_processed,
      stove_ids_created: syncResult.summary.stove_ids_created,
      stove_ids_skipped: syncResult.summary.stove_ids_skipped,
      entries,
      request_summary: {
        application_name: body.application_name,
        origin_url: body.origin_url,
        // Full incoming payload (no token/secret_key)
        organization_data: body.organization_data,
        stove_ids: body.stove_ids ?? [],
        stove_ids_count: body.stove_ids?.length ?? 0,
      },
    });

    return withCors(
      new Response(JSON.stringify({ success: true, message: "Organization data synchronized successfully", data: syncResult }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (error) {
    const errMsg = (error as Error).message;
    entries.push(mkEntry("sync", "error", errMsg));
    await writeSyncLog(supabase, {
      source: "external-sync",
      status: "failed",
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 1, partners_created: 0, partners_updated: 0, partners_failed: 1,
      total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
      entries,
      request_summary: {
        application_name: body.application_name,
        partner_id: body.organization_data?.partner_id,
        partner_name: body.organization_data?.partner_name,
      },
      error_message: errMsg,
    });
    return withCors(
      new Response(JSON.stringify({ success: false, message: "Internal server error during synchronization", error: errMsg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
});

// ─── Token validation ─────────────────────────────────────────────────────────

async function validateExternalToken(
  supabase: any,
  token: string,
  secret_key: string,
  application_name: string,
  origin_url?: string,
): Promise<TokenValidationResult> {
  try {
    const { data: tokenData, error } = await supabase
      .from("external_app_tokens")
      .select("*")
      .eq("token", token)
      .eq("secret_key", secret_key)
      .eq("application_name", application_name)
      .eq("is_active", true)
      .single();

    if (error || !tokenData) return { isValid: false, error: "Invalid token, secret key, or application name" };

    if (origin_url && tokenData.allowed_urls?.length > 0) {
      const isUrlAllowed = tokenData.allowed_urls.some(
        (allowedUrl: string) => origin_url.includes(allowedUrl) || allowedUrl === "*",
      );
      if (!isUrlAllowed) return { isValid: false, error: "Request origin not allowed for this application" };
    }

    return { isValid: true, token_data: tokenData };
  } catch {
    return { isValid: false, error: "Token validation failed" };
  }
}

// ─── Organization sync ────────────────────────────────────────────────────────

async function processOrganizationSync(
  supabase: any,
  orgData: any,
  stoveIds: any[],
  entries: LogEntry[],
  salesDate: string | null = null,
): Promise<any> {
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("*")
    .eq("partner_id", orgData.partner_id)
    .single();

  let organization;
  let userCreated = false;
  let userCredentials: UserCreationResult | null = null;

  if (existingOrg) {
    if (existingOrg.manually_edited) {
      entries.push(mkEntry("org-sync", "info", `Partner "${orgData.partner_name}" (${orgData.partner_id}) has been manually edited — skipping contact detail update, stove IDs will still be processed`));
      organization = existingOrg;
    } else {
      entries.push(mkEntry("org-sync", "info", `Partner "${orgData.partner_name}" (${orgData.partner_id}) already exists — updating`));
      const { data: updatedOrg, error: updateError } = await supabase
        .from("organizations")
        .update({
          partner_name: orgData.partner_name,
          partner_type: orgData.partner_type || null,
          email: orgData.email,
          contact_person: orgData.contact_person,
          contact_phone: orgData.contact_phone,
          alternative_phone: orgData.alternative_phone,
          address: orgData.address,
          state: orgData.state,
          branch: normalizeBranch(orgData.branch),
          updated_at: new Date().toISOString(),
        })
        .eq("partner_id", orgData.partner_id)
        .select()
        .single();

      if (updateError) throw updateError;
      organization = updatedOrg;
      entries.push(mkEntry("org-sync", "success", `Partner updated successfully (org ID: ${organization.id})`));
    }
  } else {
    entries.push(mkEntry("org-sync", "info", `Partner "${orgData.partner_name}" (${orgData.partner_id}) is new — creating`));
    const { data: newOrg, error: createError } = await supabase
      .from("organizations")
      .insert({
        partner_id: orgData.partner_id,
        partner_name: orgData.partner_name,
        partner_type: orgData.partner_type || null,
        email: orgData.email,
        contact_person: orgData.contact_person,
        contact_phone: orgData.contact_phone,
        alternative_phone: orgData.alternative_phone,
        address: orgData.address,
        state: orgData.state,
        branch: normalizeBranch(orgData.branch),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) throw createError;
    organization = newOrg;
    entries.push(mkEntry("org-sync", "success", `Partner created successfully (org ID: ${organization.id})`));

    // Check if a user already exists for this org
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (existingProfile) {
      entries.push(mkEntry("user-creation", "info", `User already exists for this organization — skipping`));
    } else {
      entries.push(mkEntry("user-creation", "info", `No user found for this organization — creating admin user`));

      let userEmail: string;
      let username: string | undefined;
      let isInternalEmail = false;
      let isDummyEmail = false;

      if (isValidEmail(orgData.email)) {
        userEmail = orgData.email.trim();
        username = generateUsername(orgData.partner_name, orgData.partner_id);
        entries.push(mkEntry("user-creation", "info", `Valid email provided — using email-based auth: ${userEmail}`));
      } else {
        username = generateUsername(orgData.partner_name, orgData.partner_id);
        userEmail = generateInternalEmail(username);
        isInternalEmail = true;
        isDummyEmail = true;
        entries.push(mkEntry("user-creation", "warn", orgData.email
          ? `Invalid email "${orgData.email}" provided — generated username-based login: ${username}`
          : `No email provided — generated username-based login: ${username}`));
      }

      const password = generatePassword();

      try {
        userCredentials = await createUserForOrganization(
          supabase, userEmail, username, password, orgData.partner_name, organization.id, isInternalEmail, entries,
        );
        await saveCredentials(
          supabase, orgData.partner_id, orgData.partner_name, userEmail, username, password,
          organization.id, userCredentials.userId, isDummyEmail, isInternalEmail, entries,
        );
        userCreated = true;
        entries.push(mkEntry("user-creation", "success", `Admin user created successfully for org ${organization.id}`));
      } catch (userError) {
        entries.push(mkEntry("user-creation", "error", `User creation failed: ${(userError as Error).message}`, { partner: orgData.partner_name }));
      }
    }
  }

  // Process stove IDs
  const stoveIdResults: StoveIdResult[] = [];

  if (stoveIds && stoveIds.length > 0) {
    entries.push(mkEntry("stove-ids", "info", `Processing ${stoveIds.length} stove ID(s)`));

    for (const stoveData of stoveIds) {
      let stoveId: string;
      let factory: string | undefined;
      let salesReference: string | undefined;

      if (typeof stoveData === "string") {
        stoveId = stoveData;
      } else if (typeof stoveData === "object" && stoveData.stove_id) {
        stoveId = stoveData.stove_id;
        factory = stoveData.factory;
        salesReference = stoveData.sales_reference;
      } else {
        entries.push(mkEntry("stove-ids", "warn", `Skipping invalid stove entry`, { raw: stoveData }));
        continue;
      }

      if (!stoveId || stoveId.trim() === "") continue;

      const { data: existingStove, error: checkError } = await supabase
        .from("stove_ids")
        .select("*")
        .eq("stove_id", stoveId.trim())
        .eq("organization_id", organization.id)
        .single();

      if (checkError && checkError.code !== "PGRST116") {
        entries.push(mkEntry("stove-ids", "warn", `Error checking stove ${stoveId}: ${checkError.message}`));
      }

      if (!existingStove) {
        const insertData: any = {
          stove_id: stoveId.trim(),
          organization_id: organization.id,
          status: "available",
          created_at: new Date().toISOString(),
        };
        if (factory) insertData.factory = factory.trim();
        if (salesReference) insertData.sales_reference = salesReference.trim();
        // Stamp the transfer's Sales Date directly — authoritative at ingest.
        if (salesDate) insertData.transfer_sales_date = salesDate;

        const { error: stoveError } = await supabase.from("stove_ids").insert(insertData).select().single();
        if (stoveError) {
          entries.push(mkEntry("stove-ids", "error", `Failed to create stove ${stoveId}: ${stoveError.message}`));
        } else {
          stoveIdResults.push({ stove_id: stoveId.trim(), factory, sales_reference: salesReference, action: "created" });
        }
      } else {
        // Re-transfer: always realign sales_reference, transfer_sales_date and
        // factory to THIS transfer (the latest ERP truth). Keeps monitoring
        // self-correcting so it never needs manual reconciliation.
        const updates: any = {};
        if (factory && existingStove.factory !== factory) updates.factory = factory.trim();
        if (salesReference && existingStove.sales_reference !== salesReference) updates.sales_reference = salesReference.trim();
        if (salesDate && existingStove.transfer_sales_date !== salesDate) updates.transfer_sales_date = salesDate;
        if (Object.keys(updates).length > 0) {
          await supabase.from("stove_ids").update(updates).eq("id", existingStove.id);
        }
        stoveIdResults.push({
          stove_id: stoveId.trim(),
          factory: factory || existingStove.factory,
          sales_reference: salesReference || existingStove.sales_reference,
          action: "already_exists",
        });
      }
    }

    entries.push(mkEntry("stove-ids", "success",
      `Stove IDs done — created: ${stoveIdResults.filter((s) => s.action === "created").length}, already existed: ${stoveIdResults.filter((s) => s.action === "already_exists").length}`));
  }

  return {
    organization: { id: organization.id, partner_id: organization.partner_id, partner_name: organization.partner_name, action: existingOrg ? "updated" : "created" },
    user: userCreated
      ? { created: true, username: userCredentials?.username, email: userCredentials?.isInternalEmail ? undefined : userCredentials?.email, password: userCredentials?.password, is_internal_email: userCredentials?.isInternalEmail, login_identifier: userCredentials?.username || userCredentials?.email }
      : { created: false, reason: existingOrg ? "Organization already exists" : "User creation failed" },
    stove_ids: stoveIdResults,
    summary: {
      organization_action: existingOrg ? "updated" : "created",
      user_created: userCreated,
      stove_ids_processed: stoveIds.length,
      stove_ids_created: stoveIdResults.filter((s) => s.action === "created").length,
      stove_ids_skipped: stoveIdResults.filter((s) => s.action === "already_exists").length,
    },
  };
}

async function updateTokenUsage(supabase: any, token: string): Promise<void> {
  try {
    await supabase
      .from("external_app_tokens")
      .update({ usage_count: supabase.sql`usage_count + 1`, last_used_at: new Date().toISOString() })
      .eq("token", token);
  } catch (error) {
    console.error("Failed to update token usage:", error);
  }
}

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

interface ExternalCSVSyncRequest {
  token: string;
  secret_key: string;
  application_name: string;
  csv_data: string;
  origin_url?: string;
}

interface ParsedOrganization {
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
  stove_ids?: Array<{ stove_id: string; factory: string; sales_reference?: string }>;
  sales_date?: string;
  customer?: string;
  downloaded_by?: string;
  sales_rep?: string;
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

// ─── Log helpers ─────────────────────────────────────────────────────────────

interface LogEntry {
  step: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  detail?: any;
  ts: string;
}

function mkEntry(step: string, level: LogEntry["level"], message: string, detail?: any): LogEntry {
  return { step, level, message, detail, ts: new Date().toISOString() };
}

// ─── Utility functions ────────────────────────────────────────────────────────

function isValidEmail(email: string | undefined | null): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();
  const invalidValues = ["", "n/a", "na", "null", "undefined", "none", "-", "nil", "n.a"];
  if (invalidValues.includes(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
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

// Parses DD/MM/YYYY or YYYY-MM-DD → ISO date string (YYYY-MM-DD), returns null if unparseable
function parseSalesDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // DD/MM/YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

function generatePassword(length = 16): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => charset[byte % charset.length]).join("");
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ["partner_id", "partner_name"];
const OPTIONAL_FIELDS = ["email", "contact_person", "contact_phone", "alternative_phone", "address", "state", "branch", "partner_type", "stove_ids", "sales_factory", "sales_reference", "sales_date", "customer", "downloaded_by", "sales_rep"];

const FIELD_MAPPINGS: Record<string, string[]> = {
  partner_id: ["partner_id", "partnerid", "partner_code", "partner-id"],
  partner_name: ["partner_name", "partnername", "partner-name", "organization_name", "org_name"],
  partner_type: ["partner_type", "partnertype", "partner-type", "partner type", "type", "org_type", "organization_type"],
  sales_factory: ["sales_factory", "salesfactory", "sales-factory", "sales factory", "factory", "stove_factory"],
  email: ["email", "email_address", "partner_email", "contact_email"],
  contact_person: ["contact_person", "contactperson", "contact-person", "contact_name", "representative"],
  contact_phone: ["contact_phone", "contactphone", "contact-phone", "primary_phone"],
  alternative_phone: ["alternative_phone", "alternativephone", "alternative-phone", "alt_phone", "secondary_phone"],
  address: ["address", "full_address", "location", "street_address", "branch"],
  state: ["state", "region", "province"],
  branch: ["branch", "branch_name", "office", "location_name"],
  stove_ids: ["stove_ids", "stove ids", "stoveids", "stove-ids", "stove_id_list", "serial_numbers", "stove_ids_with_factory"],
  sales_reference: ["sales_reference", "sales reference", "salesreference", "sales-reference", "erp_sales_reference", "erp sales reference", "sales_ref", "sales ref", "transaction_id", "txn_id"],
  sales_date: ["sales_date", "sales date", "salesdate", "sales-date", "sale_date", "sale date"],
  customer: ["customer", "customer_name", "customer name", "end_user", "end user", "end_user_name"],
  downloaded_by: ["downloaded_by", "downloaded by", "downloadedby", "downloaded-by"],
  sales_rep: ["sales_rep", "sales rep", "salesrep", "sales-rep", "sales_representative", "sales representative", "rep"],
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseFlexibleCSV(csvData: string): {
  success: boolean;
  organizations?: ParsedOrganization[];
  error?: string;
  mappings_used?: Record<string, string>;
} {
  try {
    const lines = csvData.trim().split("\n");
    if (lines.length < 2) {
      return { success: false, error: "CSV must contain at least a header row and one data row" };
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/"/g, ""));
    const mappingsUsed: Record<string, string> = {};
    const fieldMap: Record<string, number> = {};

    for (const [expectedField, variations] of Object.entries(FIELD_MAPPINGS)) {
      const exactIndex = headers.indexOf(variations[0]);
      if (exactIndex !== -1) {
        fieldMap[expectedField] = exactIndex;
        mappingsUsed[expectedField] = headers[exactIndex];
        continue;
      }
      for (let i = 0; i < headers.length; i++) {
        if (variations.slice(1).includes(headers[i])) {
          fieldMap[expectedField] = i;
          mappingsUsed[expectedField] = headers[i];
          break;
        }
      }
    }

    for (const requiredField of REQUIRED_FIELDS) {
      if (!(requiredField in fieldMap)) {
        return { success: false, error: `Required field '${requiredField}' not found. Expected one of: ${FIELD_MAPPINGS[requiredField].join(", ")}` };
      }
    }

    const organizations: ParsedOrganization[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]).map((v) => v.trim().replace(/"/g, ""));
      if (values.length === 0 || values.every((v) => !v)) continue;

      const org: ParsedOrganization = { partner_id: "", partner_name: "" };
      org.partner_id = values[fieldMap.partner_id] || "";
      org.partner_name = values[fieldMap.partner_name] || "";
      if (!org.partner_id || !org.partner_name) continue;

      let salesFactory = "";
      if ("sales_factory" in fieldMap && values[fieldMap.sales_factory]) {
        salesFactory = values[fieldMap.sales_factory].trim();
      }

      // Row-level sales_reference — applied to all stove IDs in this row
      let rowSalesReference = "";
      if ("sales_reference" in fieldMap && values[fieldMap.sales_reference]) {
        rowSalesReference = values[fieldMap.sales_reference].trim();
      }

      for (const optionalField of OPTIONAL_FIELDS) {
        if (optionalField in fieldMap && values[fieldMap[optionalField]]) {
          const value = values[fieldMap[optionalField]];
          if (optionalField === "stove_ids") {
            const stoveEntries = value.split(/[;|]/).map((e) => e.trim()).filter((e) => e);
            org.stove_ids = stoveEntries
              .map((entry) => {
                // Format options:
                //   STOVE001                          → uses row factory + row sales_reference
                //   STOVE001:FactoryA                 → uses inline factory + row sales_reference
                //   STOVE001:FactoryA:REF-123         → uses inline factory + inline sales_reference
                const parts = entry.split(":").map((s) => s.trim());
                const stove_id = parts[0];
                const factory = parts[1] || salesFactory;
                const sales_reference = parts[2] || rowSalesReference || undefined;
                return { stove_id, factory, sales_reference };
              })
              .filter((item) => item.stove_id);
          } else if (optionalField === "partner_type") {
            const normalizedType = value.trim().toLowerCase();
            if (normalizedType === "partner" || normalizedType === "customer") {
              org.partner_type = normalizedType;
            }
          } else if (optionalField === "sales_date") {
            org.sales_date = parseSalesDate(value) || undefined;
          } else if (optionalField === "customer") {
            org.customer = value;
          } else if (optionalField === "downloaded_by") {
            org.downloaded_by = value;
          } else if (optionalField === "sales_rep") {
            org.sales_rep = value;
          } else if (optionalField !== "sales_factory" && optionalField !== "sales_reference") {
            // sales_reference is handled above at row level; skip here
            (org as any)[optionalField] = value;
          }
        }
      }
      organizations.push(org);
    }

    if (organizations.length === 0) {
      return { success: false, error: "No valid organization data found in CSV" };
    }

    return { success: true, organizations, mappings_used: mappingsUsed };
  } catch (error) {
    return { success: false, error: `CSV parsing failed: ${(error as Error).message}` };
  }
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
      user_metadata: { full_name: partnerName, organization_id: organizationId, username },
    });
    if (authError) throw new Error(`Auth user creation failed: ${authError.message}`);
    if (!newAuthUser.user) throw new Error("User creation returned no user data");
    authUserId = newAuthUser.user.id;
    entries.push(mkEntry("create-user", "success", `New auth user created (ID: ${authUserId})`));
  }

  const { data: existingProfile } = await supabase.from("profiles").select("*").eq("id", authUserId).maybeSingle();

  if (existingProfile) {
    entries.push(mkEntry("create-user", "warn", `Profile already exists, updating username/role`));
    const { error: updateError } = await supabase.from("profiles").update({ username, role: "admin" }).eq("id", authUserId);
    if (updateError) {
      entries.push(mkEntry("create-user", "error", `Profile update failed: ${updateError.message}`));
    } else {
      entries.push(mkEntry("create-user", "success", `Profile updated successfully`));
    }
    const isDummyEmail = email.endsWith("@atmosfair.site");
    return { userId: authUserId!, email, username, password, isDummyEmail, isInternalEmail };
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUserId,
    full_name: partnerName,
    email,
    username,
    role: "admin",
    organization_id: organizationId,
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
  const isDummyEmail = email.endsWith("@atmosfair.site");
  return { userId: authUserId!, email, username, password, isDummyEmail, isInternalEmail };
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
    throw new Error(`Credentials save failed: ${error.message}`);
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

// ─── Token validation ─────────────────────────────────────────────────────────

async function validateExternalToken(
  supabase: any,
  token: string,
  secret_key: string,
  application_name: string,
  origin_url?: string,
): Promise<{ isValid: boolean; token_data?: any; error?: string }> {
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
  orgData: ParsedOrganization,
  stoveIds: any[],
  entries: LogEntry[],
): Promise<{ result: any; stoveCreated: number; stoveSkipped: number }> {
  // The transfer's own Sales Date — written authoritatively onto every stove
  // so transfer_sales_date never goes stale (no reliance on a separate trigger).
  const salesDate = orgData.sales_date || null;
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
      entries.push(mkEntry("org-sync", "success", `Partner updated (org ID: ${organization.id})`));
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
    entries.push(mkEntry("org-sync", "success", `Partner created (org ID: ${organization.id})`));

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (existingProfile) {
      entries.push(mkEntry("user-creation", "info", `User already exists for this organization — skipping`));
    } else {
      entries.push(mkEntry("user-creation", "info", `No user found — creating admin user`));
      let userEmail: string;
      let username: string | undefined;
      let isInternalEmail = false;
      let isDummyEmail = false;

      if (isValidEmail(orgData.email)) {
        userEmail = orgData.email!.trim();
        username = generateUsername(orgData.partner_name, orgData.partner_id);
        entries.push(mkEntry("user-creation", "info", `Valid email — using email-based auth`));
      } else {
        username = generateUsername(orgData.partner_name, orgData.partner_id);
        userEmail = generateInternalEmail(username);
        isInternalEmail = true;
        isDummyEmail = true;
        entries.push(mkEntry("user-creation", "warn", orgData.email
          ? `Invalid email "${orgData.email}" — using username-based login: ${username}`
          : `No email — using username-based login: ${username}`));
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
        entries.push(mkEntry("user-creation", "success", `Admin user created for org ${organization.id}`));
      } catch (userError) {
        entries.push(mkEntry("user-creation", "error", `User creation failed: ${(userError as Error).message}`));
      }
    }
  }

  // Process stove IDs
  const stoveIdResults: StoveIdResult[] = [];

  if (stoveIds && stoveIds.length > 0) {
    entries.push(mkEntry("stove-ids", "info", `Processing ${stoveIds.length} stove ID(s) for ${orgData.partner_name}`));

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
        // factory to THIS transfer (the latest ERP truth). This is what keeps
        // monitoring self-correcting so it never needs manual reconciliation.
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

    const created = stoveIdResults.filter((s) => s.action === "created").length;
    const skipped = stoveIdResults.filter((s) => s.action === "already_exists").length;
    entries.push(mkEntry("stove-ids", "success", `Stove IDs done — created: ${created}, already existed: ${skipped}`));
  }

  return {
    result: {
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
    },
    stoveCreated: stoveIdResults.filter((s) => s.action === "created").length,
    stoveSkipped: stoveIdResults.filter((s) => s.action === "already_exists").length,
  };
}

async function updateTokenUsage(supabase: any, token: string): Promise<void> {
  try {
    const { data: currentToken } = await supabase.from("external_app_tokens").select("usage_count").eq("token", token).single();
    if (currentToken) {
      await supabase.from("external_app_tokens").update({ usage_count: (currentToken.usage_count || 0) + 1, last_used_at: new Date().toISOString() }).eq("token", token);
    }
  } catch (error) {
    console.error("Failed to update token usage:", error);
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

  // No JWT check — this endpoint uses token/secret_key based auth
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let body: ExternalCSVSyncRequest;
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

  if (!body.token || !body.secret_key || !body.application_name || !body.csv_data) {
    const msg = "Missing required fields: token, secret_key, application_name, and csv_data are required";
    entries.push(mkEntry("validation", "error", msg));
    await writeSyncLog(supabase, {
      source: "external-csv-sync",
      status: "failed",
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 0, partners_created: 0, partners_updated: 0, partners_failed: 0,
      total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
      entries,
      request_summary: { application_name: body.application_name },
      error_message: msg,
    });
    return withCors(new Response(JSON.stringify({ success: false, message: msg }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  entries.push(mkEntry("request", "info", `CSV sync request from application: ${body.application_name}`));

  // Validate token
  const tokenValidation = await validateExternalToken(supabase, body.token, body.secret_key, body.application_name, body.origin_url);
  if (!tokenValidation.isValid) {
    const msg = tokenValidation.error || "Invalid authentication credentials";
    entries.push(mkEntry("token-validation", "error", msg));
    await writeSyncLog(supabase, {
      source: "external-csv-sync",
      status: "failed",
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 0, partners_created: 0, partners_updated: 0, partners_failed: 0,
      total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
      entries,
      request_summary: { application_name: body.application_name },
      error_message: msg,
    });
    return withCors(new Response(JSON.stringify({ success: false, message: msg }), { status: 401, headers: { "Content-Type": "application/json" } }));
  }

  entries.push(mkEntry("token-validation", "success", "Token validated successfully"));

  // Parse CSV
  const parseResult = parseFlexibleCSV(body.csv_data);
  if (!parseResult.success) {
    entries.push(mkEntry("csv-parse", "error", `CSV parsing failed: ${parseResult.error}`));
    await writeSyncLog(supabase, {
      source: "external-csv-sync",
      status: "failed",
      application_name: body.application_name,
      started_at: startedAt,
      duration_ms: Date.now() - startMs,
      total_partners: 0, partners_created: 0, partners_updated: 0, partners_failed: 0,
      total_stove_ids: 0, stove_ids_created: 0, stove_ids_skipped: 0,
      entries,
      request_summary: { application_name: body.application_name },
      error_message: parseResult.error,
    });
    return withCors(new Response(JSON.stringify({ success: false, message: parseResult.error }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  const totalPartners = parseResult.organizations!.length;
  entries.push(mkEntry("csv-parse", "success", `Parsed ${totalPartners} partner(s) from CSV`, { mappings_used: parseResult.mappings_used }));

  // Process each partner
  const results = [];
  let partnersCreated = 0;
  let partnersUpdated = 0;
  let partnersFailed = 0;
  let totalStoveIds = 0;
  let stoveIdsCreated = 0;
  let stoveIdsSkipped = 0;

  for (const orgData of parseResult.organizations!) {
    entries.push(mkEntry("partner-processing", "info", `--- Processing partner ${orgData.partner_id}: ${orgData.partner_name} ---`));
    try {
      const { result: syncResult, stoveCreated, stoveSkipped } = await processOrganizationSync(
        supabase, orgData, orgData.stove_ids || [], entries,
      );

      if (syncResult.summary.organization_action === "created") partnersCreated++;
      else partnersUpdated++;

      totalStoveIds += syncResult.summary.stove_ids_processed;
      stoveIdsCreated += stoveCreated;
      stoveIdsSkipped += stoveSkipped;

      // Write transfer history for newly created stove IDs
      const newStoves = syncResult.stove_ids.filter((s: any) => s.action === "created");
      if (newStoves.length > 0) {
        await writeTransferHistory(supabase, {
          organization_id: syncResult.organization.id,
          partner_name: orgData.partner_name,
          partner_id: orgData.partner_id,
          state: orgData.state,
          branch: orgData.branch,
          sales_factory: newStoves[0]?.factory || undefined,
          sales_date: orgData.sales_date || null,
          customer: orgData.customer || null,
          downloaded_by: orgData.downloaded_by || null,
          sales_rep: orgData.sales_rep || null,
          stove_ids: newStoves.map((s: any) => ({ stove_id: s.stove_id, factory: s.factory, sales_reference: s.sales_reference })),
          source: "external-csv-sync",
          application_name: body.application_name,
        });
      }

      results.push({ partner_id: orgData.partner_id, status: "success", result: syncResult });
    } catch (error) {
      partnersFailed++;
      const errMsg = (error as Error).message;
      entries.push(mkEntry("partner-processing", "error", `Failed to process partner ${orgData.partner_id}: ${errMsg}`));
      results.push({ partner_id: orgData.partner_id, status: "error", error: errMsg });
    }
  }

  await updateTokenUsage(supabase, body.token);

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const overallStatus: "success" | "partial" | "failed" =
    errorCount === 0 ? "success" : successCount === 0 ? "failed" : "partial";

  entries.push(mkEntry("complete", overallStatus === "failed" ? "error" : "success",
    `CSV sync complete — ${successCount} succeeded, ${errorCount} failed out of ${totalPartners} partners`));

  await writeSyncLog(supabase, {
    source: "external-csv-sync",
    status: overallStatus,
    application_name: body.application_name,
    started_at: startedAt,
    duration_ms: Date.now() - startMs,
    total_partners: totalPartners,
    partners_created: partnersCreated,
    partners_updated: partnersUpdated,
    partners_failed: partnersFailed,
    total_stove_ids: totalStoveIds,
    stove_ids_created: stoveIdsCreated,
    stove_ids_skipped: stoveIdsSkipped,
    entries,
    request_summary: {
      application_name: body.application_name,
      total_partners: totalPartners,
      field_mappings_used: parseResult.mappings_used,
      origin_url: body.origin_url,
      // Store raw CSV — truncate at 200KB to avoid bloating the DB
      csv_data: body.csv_data.length > 200000
        ? body.csv_data.substring(0, 200000) + "\n\n[TRUNCATED — original size: " + body.csv_data.length + " bytes]"
        : body.csv_data,
    },
  });

  return withCors(
    new Response(
      JSON.stringify({
        success: true,
        message: `CSV synchronization completed. ${successCount} successful, ${errorCount} failed.`,
        summary: { total_processed: results.length, successful: successCount, failed: errorCount, field_mappings_used: parseResult.mappings_used },
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

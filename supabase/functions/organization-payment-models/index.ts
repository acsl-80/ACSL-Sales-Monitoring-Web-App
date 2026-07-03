import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";

serve(async (req) => {
  console.log("🚀 Organization Payment Models API started");

  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  try {
    const REQUEST_TIMEOUT = 30000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), REQUEST_TIMEOUT)
    );

    const result = await Promise.race([executeMainLogic(req), timeoutPromise]);
    return result;
  } catch (error) {
    console.error("❌ Org Payment Models error:", error);

    let statusCode = 500;
    let errorMessage = "Internal server error";

    if (error.message?.includes("Unauthorized")) statusCode = 403;
    else if (error.message?.includes("not found")) statusCode = 404;
    else if (error.message?.includes("validation:")) {
      statusCode = 400;
      errorMessage = error.message.replace("validation: ", "");
    }
    if (statusCode !== 500) errorMessage = error.message;

    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: errorMessage,
          timestamp: new Date().toISOString(),
        }),
        { status: statusCode, headers: { "Content-Type": "application/json" } }
      )
    );
  }
});

async function executeMainLogic(req: Request) {
  const startTime = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { userId, userRole } = await authenticate(supabase, authHeader);

  // Parse path: /organization-payment-models/:orgId or /organization-payment-models/:orgId/:modelId
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts: ["organization-payment-models", orgId] or ["organization-payment-models", orgId, modelId]
  const orgId = pathParts.length >= 2 ? pathParts[1] : null;
  const modelId = pathParts.length >= 3 ? pathParts[2] : null;

  if (!orgId) throw new Error("validation: Organization ID is required in URL path");

  let result: any;

  if (req.method === "GET") {
    result = await getOrgModels(supabase, orgId, userRole);
  } else if (req.method === "POST") {
    if (userRole !== "super_admin") throw new Error("Unauthorized: Super admin only");
    const body = await req.json();
    result = await setOrgModels(supabase, orgId, body.payment_model_ids || [], userId);
  } else if (req.method === "DELETE" && modelId) {
    if (userRole !== "super_admin") throw new Error("Unauthorized: Super admin only");
    result = await removeOrgModel(supabase, orgId, modelId);
  } else {
    throw new Error("Route not found");
  }

  const responseTime = Date.now() - startTime;

  return withCors(
    new Response(
      JSON.stringify({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
        performance: { responseTime: `${responseTime}ms` },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    )
  );
}

// ─── Get models assigned to an organization ──────────────────────────────────
async function getOrgModels(supabase: any, orgId: string, userRole: string) {
  console.log("📋 Fetching payment models for org:", orgId);

  const { data, error } = await supabase
    .from("organization_payment_models")
    .select(`
      id,
      assigned_at,
      assigned_by,
      payment_model:payment_models (
        id,
        name,
        description,
        duration_months,
        fixed_price,
        min_down_payment,
        is_active
      )
    `)
    .eq("organization_id", orgId)
    .order("assigned_at", { ascending: false });

  if (error) throw new Error(`Database error: ${error.message}`);

  // Filter to active models only for non-super-admins
  let models = data || [];
  if (userRole !== "super_admin") {
    models = models.filter((m: any) => m.payment_model?.is_active);
  }

  console.log(`✅ Found ${models.length} payment models for org`);

  return {
    message: `Found ${models.length} assigned payment models`,
    data: models,
  };
}

// ─── Set models for org (full replace) ───────────────────────────────────────
async function setOrgModels(
  supabase: any,
  orgId: string,
  modelIds: string[],
  assignedBy: string
) {
  console.log("📝 Setting payment models for org:", orgId, "models:", modelIds);

  // Verify org exists
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .single();

  if (orgError) throw new Error("Organization not found");

  // Verify all model IDs exist and are active
  if (modelIds.length > 0) {
    const { data: validModels, error: modelsError } = await supabase
      .from("payment_models")
      .select("id")
      .in("id", modelIds)
      .eq("is_active", true);

    if (modelsError) throw new Error(`Database error: ${modelsError.message}`);

    const validIds = new Set((validModels || []).map((m: any) => m.id));
    const invalidIds = modelIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      throw new Error(`validation: Invalid or inactive model IDs: ${invalidIds.join(", ")}`);
    }
  }

  // Delete existing assignments
  const { error: deleteError } = await supabase
    .from("organization_payment_models")
    .delete()
    .eq("organization_id", orgId);

  if (deleteError) throw new Error(`Database error: ${deleteError.message}`);

  // Insert new assignments
  if (modelIds.length > 0) {
    const rows = modelIds.map((modelId) => ({
      organization_id: orgId,
      payment_model_id: modelId,
      assigned_by: assignedBy,
    }));

    const { error: insertError } = await supabase
      .from("organization_payment_models")
      .insert(rows);

    if (insertError) throw new Error(`Database error: ${insertError.message}`);
  }

  console.log(`✅ Set ${modelIds.length} payment models for org ${orgId}`);

  return {
    message: `Successfully assigned ${modelIds.length} payment model(s)`,
    data: { organization_id: orgId, assigned_count: modelIds.length },
  };
}

// ─── Remove single model assignment ──────────────────────────────────────────
async function removeOrgModel(supabase: any, orgId: string, modelId: string) {
  console.log("🗑️ Removing model", modelId, "from org", orgId);

  const { error } = await supabase
    .from("organization_payment_models")
    .delete()
    .eq("organization_id", orgId)
    .eq("payment_model_id", modelId);

  if (error) throw new Error(`Database error: ${error.message}`);

  console.log("✅ Model assignment removed");

  return { message: "Payment model assignment removed" };
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";

serve(async (req) => {
  console.log("🚀 Payment Models API started");
  console.log("📥 Request:", req.method, req.url);

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
    console.error("❌ Payment Models error:", error);

    let statusCode = 500;
    let errorMessage = "Internal server error";

    if (error.message?.includes("Unauthorized")) {
      statusCode = 403;
      errorMessage = error.message;
    } else if (error.message?.includes("not found")) {
      statusCode = 404;
      errorMessage = error.message;
    } else if (error.message?.includes("validation:")) {
      statusCode = 400;
      errorMessage = error.message.replace("validation: ", "");
    } else if (error.message?.includes("timeout")) {
      statusCode = 408;
      errorMessage = "Request timeout";
    }

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

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Path: /payment-models or /payment-models/:id
  const modelId = pathParts.length >= 2 ? pathParts[pathParts.length - 1] : null;
  // Check if it looks like a UUID
  const isUUID = modelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(modelId);

  let result: any;

  if (req.method === "GET" && !isUUID) {
    result = await listModels(supabase, url.searchParams, userRole);
  } else if (req.method === "GET" && isUUID) {
    result = await getModel(supabase, modelId!);
  } else if (req.method === "POST") {
    if (userRole !== "super_admin") throw new Error("Unauthorized: Super admin only");
    const body = await req.json();
    result = await createModel(supabase, body, userId);
  } else if (req.method === "PATCH" && isUUID) {
    if (userRole !== "super_admin") throw new Error("Unauthorized: Super admin only");
    const body = await req.json();
    result = await updateModel(supabase, modelId!, body);
  } else if (req.method === "DELETE" && isUUID) {
    if (userRole !== "super_admin") throw new Error("Unauthorized: Super admin only");
    result = await deleteModel(supabase, modelId!);
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

// ─── List all payment models ─────────────────────────────────────────────────
async function listModels(supabase: any, searchParams: URLSearchParams, userRole: string) {
  console.log("📋 Listing payment models...");

  let query = supabase
    .from("payment_models")
    .select("*, creator:profiles!created_by(id, full_name, email)", { count: "exact" });

  // Non-super-admins only see active models
  const showAll = searchParams.get("show_all") === "true";
  if (userRole !== "super_admin" || !showAll) {
    query = query.eq("is_active", true);
  } else {
    // Super admin with show_all=true — allow optional status filter
    const statusFilter = searchParams.get("status");
    if (statusFilter === "active") {
      query = query.eq("is_active", true);
    } else if (statusFilter === "inactive") {
      query = query.eq("is_active", false);
    }
  }

  const search = searchParams.get("search") || "";
  if (search.trim()) {
    query = query.ilike("name", `%${search}%`);
  }

  query = query.order("created_at", { ascending: false });

  const { data, error, count } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);

  console.log(`✅ Found ${data?.length || 0} payment models`);

  // Find top used model from sales
  let topModel: { name: string; use_count: number } | null = null;
  try {
    const { data: salesData } = await supabase
      .from("sales")
      .select("payment_model_id, payment_models!payment_model_id(name)")
      .not("payment_model_id", "is", null);

    if (salesData && salesData.length > 0) {
      const counts: Record<string, { name: string; count: number }> = {};
      for (const sale of salesData) {
        const id = sale.payment_model_id;
        if (!id) continue;
        const name = sale.payment_models?.name ?? "Unknown";
        if (!counts[id]) counts[id] = { name, count: 0 };
        counts[id].count++;
      }
      const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
      if (sorted.length > 0) {
        topModel = { name: sorted[0].name, use_count: sorted[0].count };
      }
    }
  } catch (_) {
    // non-critical
  }

  return {
    message: `Found ${count || 0} payment models`,
    data: data || [],
    total: count || 0,
    top_model: topModel,
  };
}

// ─── Get single model ────────────────────────────────────────────────────────
async function getModel(supabase: any, modelId: string) {
  console.log("🔍 Fetching payment model:", modelId);

  const { data, error } = await supabase
    .from("payment_models")
    .select("*, creator:profiles!created_by(id, full_name, email)")
    .eq("id", modelId)
    .single();

  if (error) {
    if (error.code === "PGRST116") throw new Error("Payment model not found");
    throw new Error(`Database error: ${error.message}`);
  }

  // Also fetch count of organizations assigned
  const { count: orgCount } = await supabase
    .from("organization_payment_models")
    .select("*", { count: "exact", head: true })
    .eq("payment_model_id", modelId);

  console.log("✅ Payment model found:", data.name);

  return {
    message: "Payment model retrieved successfully",
    data: { ...data, assigned_organizations_count: orgCount || 0 },
  };
}

// ─── Create model ────────────────────────────────────────────────────────────
async function createModel(supabase: any, body: any, userId: string) {
  console.log("➕ Creating payment model...");

  const { name, description, duration_months, fixed_price, min_down_payment } = body;

  if (!name?.trim()) throw new Error("validation: Name is required");
  if (!duration_months || duration_months < 1) throw new Error("validation: Duration must be at least 1 month");
  if (!fixed_price || fixed_price <= 0) throw new Error("validation: Fixed price must be greater than 0");
  if (min_down_payment && min_down_payment < 0) throw new Error("validation: Minimum down payment cannot be negative");
  if (min_down_payment && min_down_payment > fixed_price) throw new Error("validation: Minimum down payment cannot exceed fixed price");

  const { data, error } = await supabase
    .from("payment_models")
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      duration_months,
      fixed_price,
      min_down_payment: min_down_payment || 0,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw new Error(`Database error: ${error.message}`);

  console.log("✅ Payment model created:", data.id);

  return {
    message: "Payment model created successfully",
    data,
  };
}

// ─── Update model ────────────────────────────────────────────────────────────
async function updateModel(supabase: any, modelId: string, body: any) {
  console.log("✏️ Updating payment model:", modelId);

  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.duration_months !== undefined) {
    if (body.duration_months < 1) throw new Error("validation: Duration must be at least 1 month");
    updates.duration_months = body.duration_months;
  }
  if (body.fixed_price !== undefined) {
    if (body.fixed_price <= 0) throw new Error("validation: Fixed price must be greater than 0");
    updates.fixed_price = body.fixed_price;
  }
  if (body.min_down_payment !== undefined) updates.min_down_payment = body.min_down_payment;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  if (Object.keys(updates).length === 0) throw new Error("validation: No fields to update");

  const { data, error } = await supabase
    .from("payment_models")
    .update(updates)
    .eq("id", modelId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") throw new Error("Payment model not found");
    throw new Error(`Database error: ${error.message}`);
  }

  console.log("✅ Payment model updated:", modelId);

  return {
    message: "Payment model updated successfully",
    data,
  };
}

// ─── Delete model ────────────────────────────────────────────────────────────
async function deleteModel(supabase: any, modelId: string) {
  console.log("🗑️ Deleting payment model:", modelId);

  // Check if any sales reference this model
  const { count: salesCount } = await supabase
    .from("sales")
    .select("*", { count: "exact", head: true })
    .eq("payment_model_id", modelId);

  if (salesCount && salesCount > 0) {
    // Soft delete — deactivate instead
    const { data, error } = await supabase
      .from("payment_models")
      .update({ is_active: false })
      .eq("id", modelId)
      .select()
      .single();

    if (error) throw new Error(`Database error: ${error.message}`);

    console.log("✅ Payment model deactivated (has sales):", modelId);
    return {
      message: "Payment model deactivated (has associated sales, cannot hard delete)",
      data,
    };
  }

  // Hard delete — no sales reference it
  // First remove org assignments
  await supabase
    .from("organization_payment_models")
    .delete()
    .eq("payment_model_id", modelId);

  const { error } = await supabase
    .from("payment_models")
    .delete()
    .eq("id", modelId);

  if (error) throw new Error(`Database error: ${error.message}`);

  console.log("✅ Payment model deleted:", modelId);

  return { message: "Payment model deleted successfully" };
}

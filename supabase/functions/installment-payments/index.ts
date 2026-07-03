import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";

serve(async (req) => {
  console.log("🚀 Installment Payments API started");

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
    console.error("❌ Installment Payments error:", error);

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
  const auth = await authenticate(supabase, authHeader);

  // Parse path: /installment-payments/:saleId
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const saleId = pathParts.length >= 2 ? pathParts[1] : null;

  if (!saleId) throw new Error("validation: Sale ID is required in URL path");

  // Verify sale exists and user has access
  const sale = await verifySaleAccess(supabase, saleId, auth);

  let result: any;

  if (req.method === "GET") {
    result = await listPayments(supabase, saleId, sale);
  } else if (req.method === "POST") {
    const body = await req.json();
    result = await recordPayment(supabase, saleId, sale, body, auth.userId);
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

// ─── Verify sale exists and user can access it ───────────────────────────────
async function verifySaleAccess(supabase: any, saleId: string, auth: any) {
  const { data: sale, error } = await supabase
    .from("sales")
    .select("id, organization_id, amount, is_installment, payment_model_id, total_paid, payment_status")
    .eq("id", saleId)
    .single();

  if (error) {
    if (error.code === "PGRST116") throw new Error("Sale not found");
    throw new Error(`Database error: ${error.message}`);
  }

  // Authorization check
  if (["partner", "admin", "partner_agent", "agent"].includes(auth.userRole)) {
    if (sale.organization_id !== auth.organizationId) {
      throw new Error("Unauthorized: You do not have access to this sale");
    }
  } else if (auth.userRole === "acsl_agent" || auth.userRole === "super_admin_agent") {
    if (!auth.assignedOrgIds?.includes(sale.organization_id)) {
      throw new Error("Unauthorized: You are not assigned to this organization");
    }
  }
  // super_admin has access to everything

  return sale;
}

// ─── List payments for a sale ────────────────────────────────────────────────
async function listPayments(supabase: any, saleId: string, sale: any) {
  console.log("📋 Listing installment payments for sale:", saleId);

  const { data: payments, error } = await supabase
    .from("installment_payments")
    .select(`
      id,
      amount,
      payment_method,
      proof_image_url,
      proof_image_id,
      notes,
      payment_date,
      created_at,
      recorder:profiles!recorded_by (id, full_name, email)
    `)
    .eq("sale_id", saleId)
    .order("payment_date", { ascending: true });

  if (error) throw new Error(`Database error: ${error.message}`);

  // Also fetch model info if it's an installment sale
  let paymentModel = null;
  if (sale.payment_model_id) {
    const { data: model } = await supabase
      .from("payment_models")
      .select("id, name, duration_months, fixed_price, min_down_payment")
      .eq("id", sale.payment_model_id)
      .single();
    paymentModel = model;
  }

  const totalAmount = parseFloat(sale.amount) || 0;
  const totalPaid = parseFloat(sale.total_paid) || 0;
  const remaining = Math.max(0, totalAmount - totalPaid);
  const progressPercent = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;

  console.log(`✅ Found ${payments?.length || 0} payments`);

  return {
    message: `Found ${payments?.length || 0} installment payments`,
    data: payments || [],
    summary: {
      total_amount: totalAmount,
      total_paid: totalPaid,
      remaining,
      progress_percent: progressPercent,
      payment_status: sale.payment_status,
      is_installment: sale.is_installment,
      payment_count: payments?.length || 0,
    },
    payment_model: paymentModel,
  };
}

// ─── Record a new payment ────────────────────────────────────────────────────
async function recordPayment(
  supabase: any,
  saleId: string,
  sale: any,
  body: any,
  userId: string
) {
  console.log("💰 Recording installment payment for sale:", saleId);

  if (!sale.is_installment) {
    throw new Error("validation: This sale is not an installment payment sale");
  }

  if (sale.payment_status === "fully_paid") {
    throw new Error("validation: This sale is already fully paid");
  }

  const { amount, payment_method, proof_image_id, proof_image_url, notes, payment_date } = body;

  if (!amount || amount <= 0) throw new Error("validation: Amount must be greater than 0");
  if (!payment_method) throw new Error("validation: Payment method is required");
  if (!["cash", "transfer", "pos"].includes(payment_method)) {
    throw new Error("validation: Payment method must be cash, transfer, or pos");
  }

  const totalAmount = parseFloat(sale.amount) || 0;
  const currentTotalPaid = parseFloat(sale.total_paid) || 0;
  const remaining = totalAmount - currentTotalPaid;

  if (amount > remaining) {
    throw new Error(
      `validation: Payment amount (${amount}) exceeds remaining balance (${remaining})`
    );
  }

  // Insert the payment record
  const { data: payment, error: insertError } = await supabase
    .from("installment_payments")
    .insert({
      sale_id: saleId,
      amount,
      payment_method,
      proof_image_id: proof_image_id || null,
      proof_image_url: proof_image_url || null,
      notes: notes?.trim() || null,
      recorded_by: userId,
      payment_date: payment_date || new Date().toISOString().split("T")[0],
    })
    .select()
    .single();

  if (insertError) throw new Error(`Database error: ${insertError.message}`);

  // Update sales totals
  const newTotalPaid = currentTotalPaid + amount;
  const newPaymentStatus = newTotalPaid >= totalAmount ? "fully_paid" : "partially_paid";

  const { error: updateError } = await supabase
    .from("sales")
    .update({
      total_paid: newTotalPaid,
      payment_status: newPaymentStatus,
    })
    .eq("id", saleId);

  if (updateError) throw new Error(`Database error: ${updateError.message}`);

  console.log(
    `✅ Payment recorded: ₦${amount}. Total paid: ₦${newTotalPaid}/${totalAmount}. Status: ${newPaymentStatus}`
  );

  return {
    message: "Payment recorded successfully",
    data: payment,
    updated_sale: {
      total_paid: newTotalPaid,
      payment_status: newPaymentStatus,
      remaining: totalAmount - newTotalPaid,
    },
  };
}

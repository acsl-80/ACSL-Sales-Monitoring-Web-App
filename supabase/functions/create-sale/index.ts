import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

function withCors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res;
}

function jsonError(message: string, status = 400): Response {
  return withCors(
    new Response(JSON.stringify({ success: false, message }), { status })
  );
}

Deno.serve(async (req) => {
  console.log("➡️ Incoming request:", req.method, req.url);

  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  // Use service role to bypass RLS for writes
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    }
  );

  try {
    const body = await req.json();
    console.log("📦 Request body received (keys):", Object.keys(body));

    const {
      transactionId,
      stoveSerialNo,
      salesDate,
      contactPerson,
      contactPhone,
      endUserName,
      aka,
      stateBackup,
      lgaBackup,
      phone,
      otherPhone,
      partnerName,
      retailerBranch,
      amount,
      amountReceived,
      signature,
      addressData,
      stoveImageId,
      agreementImageId,
      // New stove set fields
      potQuantity,
      heatRetentionDevice,
      // New cooking habits fields
      previousStoveType,
      previousStoveOther,
      mealsPerDay,
      cookingFuelSource,
      cookingLocation,
      // Terms & conditions
      termsAccepted,
      // SAA-specific: explicit organization override
      organizationId: requestedOrgId,
      // Installment payment fields
      isInstallment,
      paymentModelId,
      initialPaymentAmount,
      initialPaymentMethod,
      initialPaymentProofImageId,
    } = body;

    // ── Authenticate ─────────────────────────────────────────────────────────
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const { data: userData, error: authError } =
      await anonClient.auth.getUser();
    if (authError || !userData?.user) {
      return jsonError("Unauthorized", 401);
    }
    const userId = userData.user.id;
    console.log("✅ Authenticated user:", userId);

    // ── Resolve organization_id ───────────────────────────────────────────────
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("❌ Profile fetch failed:", profileError.message);
      return jsonError("Profile lookup failed", 500);
    }

    let organizationId: string | null = profile?.organization_id ?? null;

    if (!organizationId) {
      const isSuperAdmin = profile?.role === "super_admin";
      const isAgent = profile?.role === "acsl_agent" || profile?.role === "acsl_agent_manager" || profile?.role === "super_admin_agent";

      if (!isSuperAdmin && !isAgent) {
        return jsonError("User must belong to an organization");
      }

      if (!requestedOrgId) {
        return jsonError(
          isSuperAdmin
            ? "Organization ID is required for super admin sales"
            : "Organization ID is required for ACSL agents"
        );
      }

      // Super admins can use any org; agents must be assigned to it
      if (!isSuperAdmin) {
        const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, userId);
        if (!assignedOrgIds.includes(requestedOrgId)) {
          return jsonError(
            "You are not assigned to the specified organization",
            403
          );
        }
      }

      organizationId = requestedOrgId;
    }

    console.log("🏢 Resolved organization ID:", organizationId);

    // ── Required-field validation ─────────────────────────────────────────────
    // Reject with a field-specific message rather than silently writing a row.
    const isBlank = (v: unknown) =>
      v === null || v === undefined || String(v).trim() === "";

    const requiredFieldChecks: Array<[unknown, string]> = [
      [transactionId, "Transaction ID is required"],
      [salesDate, "Sales date is required"],
      [contactPerson, "Contact person is required"],
      [contactPhone, "Contact phone is required"],
      [endUserName, "End user name is required"],
      [phone, "Phone number is required"],
      [partnerName, "Partner name is required"],
      [stoveSerialNo, "Stove serial number is required"],
    ];
    for (const [value, message] of requiredFieldChecks) {
      if (isBlank(value)) {
        return jsonError(message, 400);
      }
    }

    // ── Amount validation ─────────────────────────────────────────────────────
    // The sales amount is the operator-entered value for both direct and
    // installment sales. For installment sales the payment model's fixed price is
    // only a default the client pre-fills — the operator may edit it upward — so
    // the amount is always required and validated here.
    const AMOUNT_CEILING = 900_000_000; // ₦900,000,000 upper bound
    {
      const parsedAmount = Number(amount);
      if (amount === null || amount === undefined || Number.isNaN(parsedAmount)) {
        return jsonError("Amount is required and must be a number", 400);
      }
      if (parsedAmount <= 0) {
        return jsonError("Amount must be greater than zero", 400);
      }
      if (parsedAmount > AMOUNT_CEILING) {
        return jsonError(
          `Amount exceeds the maximum allowed of ₦${AMOUNT_CEILING.toLocaleString()}`,
          400
        );
      }
    }

    // ── Terms & conditions consent ────────────────────────────────────────────
    const requiredConsents = [
      "poaGoverned",
      "monitoring",
      "noResell",
      "emissionReductions",
      "noExport",
      "demonstration",
    ];
    if (!termsAccepted || typeof termsAccepted !== "object") {
      return jsonError("Terms & conditions must be accepted", 400);
    }
    const missingConsents = requiredConsents.filter(
      (key) => termsAccepted[key] !== true
    );
    if (missingConsents.length > 0) {
      return jsonError(
        `All terms & conditions must be accepted (missing: ${missingConsents.join(", ")})`,
        400
      );
    }

    // ── Duplicate transaction ID ──────────────────────────────────────────────
    const { data: existingTxn, error: txnLookupError } = await supabase
      .from("sales")
      .select("id")
      .eq("transaction_id", transactionId)
      .maybeSingle();
    if (txnLookupError) {
      console.error("❌ Transaction ID lookup failed:", txnLookupError.message);
      return jsonError("Could not verify transaction ID uniqueness", 500);
    }
    if (existingTxn) {
      return jsonError(
        `A sale with transaction ID "${transactionId}" already exists`,
        409
      );
    }

    // ── Stove availability ────────────────────────────────────────────────────
    // The stove must belong to this org and must not already be sold.
    const { data: stoveRecord, error: stoveLookupError } = await supabase
      .from("stove_ids")
      .select("stove_id, status")
      .eq("stove_id", stoveSerialNo)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (stoveLookupError) {
      console.error("❌ Stove lookup failed:", stoveLookupError.message);
      return jsonError("Could not verify stove availability", 500);
    }
    if (!stoveRecord) {
      return jsonError(
        `Stove serial number "${stoveSerialNo}" is not registered to this organization`,
        400
      );
    }
    if (stoveRecord.status === "sold") {
      return jsonError(
        `Stove serial number "${stoveSerialNo}" has already been sold`,
        409
      );
    }

    // Normalize optional proof image empty string to null
    const safeInitialPaymentProofImageId =
      initialPaymentProofImageId && String(initialPaymentProofImageId).trim() !== ""
        ? initialPaymentProofImageId
        : null;

    // ── Installment payment validation ──────────────────────────────────────
    let saleAmount = amount;
    let installmentData: any = null;

    if (isInstallment && paymentModelId) {
      console.log("💳 Installment mode: validating payment model", paymentModelId);

      // Payment models are decoupled from partners — any active model is allowed.



      // Fetch model details
      const { data: paymentModel, error: modelError } = await supabase
        .from("payment_models")
        .select("id, name, fixed_price, min_down_payment, is_active, duration_months")
        .eq("id", paymentModelId)
        .single();

      if (modelError || !paymentModel) {
        return jsonError("Payment model not found", 404);
      }

      if (!paymentModel.is_active) {
        return jsonError("This payment model is no longer active");
      }

      // The sales amount is operator-editable. Honor the client-supplied `amount`
      // (validated above); the model's fixed price is only used as a fallback when
      // the client did not send an amount.
      const parsedSaleAmount = Number(amount);
      saleAmount = Number.isNaN(parsedSaleAmount) ? paymentModel.fixed_price : parsedSaleAmount;

      // Open-ended, optional down payment. The initial payment is whatever the
      // customer actually pays — taken from `initialPaymentAmount`, falling back
      // to `amountReceived`. No down payment is required (defaults to 0), there is
      // no minimum, and it may exceed the model's fixed price.
      const rawInitial =
        initialPaymentAmount ?? amountReceived;
      const parsedInitial = parseFloat(rawInitial);
      const initialAmt = Number.isNaN(parsedInitial) ? 0 : Math.max(0, parsedInitial);

      installmentData = {
        modelId: paymentModelId,
        initialAmount: initialAmt,
        paymentMethod: initialPaymentMethod || "cash",
        proofImageId: safeInitialPaymentProofImageId,
        totalPaid: initialAmt,
        paymentStatus: initialAmt >= saleAmount ? "fully_paid" : initialAmt > 0 ? "partially_paid" : "partially_paid",
      };

      console.log("✅ Installment validated:", paymentModel.name, "Price:", saleAmount);
    }

    // ── Amount received validation ────────────────────────────────────────────
    // Amount received is what the customer actually pays. It cannot be negative
    // and cannot exceed the sales amount.
    if (amountReceived !== null && amountReceived !== undefined && String(amountReceived).trim() !== "") {
      const parsedReceived = Number(amountReceived);
      if (Number.isNaN(parsedReceived)) {
        return jsonError("Amount received must be a number", 400);
      }
      if (parsedReceived < 0) {
        return jsonError("Amount received cannot be negative", 400);
      }
      if (parsedReceived > saleAmount) {
        return jsonError("Amount received cannot be greater than the sales amount", 400);
      }
    }

    // Validate required image IDs — reject empty strings (Flutter must upload before submitting)
    if (!stoveImageId || String(stoveImageId).trim() === "") {
      return jsonError("Stove image is required", 400);
    }
    // TEMP: agreement image not required for now — re-enable later
    // if (!agreementImageId || String(agreementImageId).trim() === "") {
    //   return jsonError("Agreement image is required", 400);
    // }
    // Agreement image is optional — normalize empty string to null so the
    // uuid column doesn't reject "" with a 22P02 error.
    const safeAgreementImageId =
      agreementImageId && String(agreementImageId).trim() !== ""
        ? agreementImageId
        : null;
    // ── Insert address ────────────────────────────────────────────────────────
    console.log("📍 Inserting address:", addressData);
    const { data: address, error: addressError } = await supabase
      .from("addresses")
      .insert([
        {
          full_address: addressData?.fullAddress,
          street: addressData?.street,
          city: addressData?.city,
          state: addressData?.state,
          country: addressData?.country,
          latitude: addressData?.latitude,
          longitude: addressData?.longitude,
        },
      ])
      .select()
      .maybeSingle();

    if (addressError || !address) {
      console.error("❌ Address save failed:", addressError);
      return jsonError("Address save failed", 500);
    }
    console.log("🏡 Address inserted:", address.id);

    // ── Determine sale status ─────────────────────────────────────────────────
    // const requiredFields = [
    //   transactionId,
    //   stoveSerialNo,
    //   salesDate,
    //   contactPerson,
    //   contactPhone,
    //   endUserName,
    //   phone,
    //   partnerName,
    //   amount,
    // ];
    // const hasAllRequiredFields = requiredFields.every(
    //   (f) => f !== null && f !== undefined && String(f).trim() !== ""
    // );
    // const hasSignature = signature && String(signature).trim() !== "";
    // const hasStoveImage = stoveImageId != null;
    // const hasAgreementImage = agreementImageId != null;

    // let saleStatus = "incomplete";
    // if (hasAllRequiredFields && hasSignature && hasStoveImage && hasAgreementImage) {
    //   saleStatus = "completed";
    // } else if (
    //   hasAllRequiredFields &&
    //   (hasSignature || hasStoveImage || hasAgreementImage)
    // ) {
    //   saleStatus = "pending";
    // }

    // ── Determine sale status ─────────────────────────────────────────────────
// Agreement image is NOT compulsory, therefore it should not affect
// whether a sale is completed or not.

const requiredFields = [
  transactionId,
  stoveSerialNo,
  salesDate,
  contactPerson,
  contactPhone,
  endUserName,
  phone,
  partnerName,
  saleAmount, // use the final amount being saved
];

const hasAllRequiredFields = requiredFields.every(
  (f) => f !== null &&
         f !== undefined &&
         String(f).trim() !== ""
);

const hasSignature =
  signature !== null &&
  signature !== undefined &&
  String(signature).trim() !== "";

const hasStoveImage =
  stoveImageId !== null &&
  stoveImageId !== undefined &&
  String(stoveImageId).trim() !== "";

// Agreement image is optional
let saleStatus = "incomplete";

if (
  hasAllRequiredFields &&
  hasSignature &&
  hasStoveImage
) {
  saleStatus = "completed";
} else if (
  hasAllRequiredFields &&
  (hasSignature || hasStoveImage)
) {
  saleStatus = "pending";
}

console.log("📋 Sale status evaluation:", {
  hasAllRequiredFields,
  hasSignature,
  hasStoveImage,
  saleStatus,
});

    // ── Insert sale ───────────────────────────────────────────────────────────
    console.log("📝 Inserting main sale with status:", saleStatus);
    const { data: saleInsertData, error: saleError } = await supabase
      .from("sales")
      .insert([
        {
          transaction_id: transactionId,
          stove_serial_no: stoveSerialNo,
          sales_date: salesDate,
          contact_person: contactPerson,
          contact_phone: contactPhone,
          end_user_name: endUserName,
          aka,
          state_backup: stateBackup,
          lga_backup: lgaBackup,
          phone,
          other_phone: otherPhone,
          partner_name: partnerName,
          retailer_branch: retailerBranch || null,
          amount: saleAmount,
          signature,
          status: saleStatus,
          created_by: userId,
          organization_id: organizationId,
          address_id: address.id,
          stove_image_id: stoveImageId,
          agreement_image_id: safeAgreementImageId,
          is_installment: !!installmentData,
          payment_model_id: installmentData?.modelId || null,
          total_paid: installmentData?.totalPaid || 0,
          payment_status: installmentData ? installmentData.paymentStatus : "not_applicable",
          pot_quantity: potQuantity ?? null,
          heat_retention_device: heatRetentionDevice ?? false,
          previous_stove_type: previousStoveType || null,
          previous_stove_other: previousStoveOther || null,
          meals_per_day: mealsPerDay || null,
          cooking_fuel_source: cookingFuelSource || null,
          cooking_location: cookingLocation || null,
          terms_accepted: termsAccepted ?? null,
        },
      ])
      .select("id")
      .maybeSingle();

    if (saleError || !saleInsertData?.id) {
      console.error("❌ Sales insert failed:", saleError);
      return jsonError("Sales save failed", 500);
    }

    const saleId = saleInsertData.id;
    console.log("✅ Sale inserted:", saleId);

    // ── Update stove_ids ──────────────────────────────────────────────────────
    const { error: stoveUpdateError } = await supabase
      .from("stove_ids")
      .update({ status: "sold", sale_id: saleId })
      .eq("stove_id", stoveSerialNo)
      .eq("organization_id", organizationId);

    if (stoveUpdateError) {
      console.error("❌ Failed to update stove_ids:", stoveUpdateError);
      return jsonError("Failed to update stove_ids", 500);
    }

    console.log("✅ Sales saved and stove_ids updated with sale_id:", saleId);

    // ── Record initial installment payment (if any) ─────────────────────────
    if (installmentData && installmentData.initialAmount > 0) {
      console.log("💰 Recording initial installment payment:", installmentData.initialAmount);
      const { error: paymentError } = await supabase
        .from("installment_payments")
        .insert({
          sale_id: saleId,
          amount: installmentData.initialAmount,
          payment_method: installmentData.paymentMethod,
          proof_image_id: installmentData.proofImageId,
          recorded_by: userId,
          payment_date: salesDate || new Date().toISOString().split("T")[0],
          notes: "Initial down payment",
        });

      if (paymentError) {
        console.error("⚠️ Initial payment insert failed:", paymentError.message);
      } else {
        console.log("✅ Initial installment payment recorded");
      }
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          message: "Sales saved successfully",
          status: saleStatus,
          sale_id: saleId,
          data: { id: saleId },
        }),
        { status: 200 }
      )
    );
  } catch (err) {
    console.error("🔥 Unexpected Error:", err);
    return jsonError("Unexpected error", 500);
  }
});

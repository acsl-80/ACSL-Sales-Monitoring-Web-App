// Update the end-user portion of a sale.
// Allowed roles: super_admin, acsl_agent_manager, acsl_agent, partner,
// partner_agent (partner/partner_agent are scoped to their own
// organization_id). Sets updated_at / updated_by.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function isValidNgPhone(raw: unknown): boolean {
  if (!raw) return false;
  const cleaned = String(raw).replace(/[\s\-()]/g, "");
  return /^(?:0|\+?234)[7-9][0-1]\d{8}$/.test(cleaned);
}

const PHONE_FORMAT_MESSAGE =
  "Enter a valid phone number (e.g. 08031234567, +2348031234567, or 2348031234567).";

Deno.serve(async (req) => {
  console.log("➡️ update-sale:", req.method, req.url);
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    }
  );

  try {
    const url = new URL(req.url);
    const saleId = url.searchParams.get("id");
    if (!saleId) return jsonError("Sale ID is required", 400);

    const body = await req.json();

    // Authenticate
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
      }
    );
    const { data: userData, error: authError } = await anonClient.auth.getUser();
    if (authError || !userData?.user) return jsonError("Unauthorized", 401);
    const userId = userData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) return jsonError("Profile not found", 403);

    const ALLOWED = [
      "super_admin",
      "acsl_agent_manager",
      "acsl_agent",
      "partner",
      "partner_agent",
      "admin",
    ];
    if (!ALLOWED.includes(profile.role)) {
      return jsonError("You do not have permission to edit sales", 403);
    }

    // Load current sale (need address_id + organization_id for scoping)
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .select("id, organization_id, address_id, phone")
      .eq("id", saleId)
      .maybeSingle();
    if (saleErr || !sale) return jsonError("Sale not found", 404);

    // Partner-side roles are scoped to their own org; ACSL roles (agent,
    // agent manager, super admin) have system-wide access.
    if (
      (profile.role === "partner" ||
        profile.role === "admin" ||
        profile.role === "partner_agent") &&
      sale.organization_id !== profile.organization_id
    ) {
      return jsonError("You can only edit sales for your own organization", 403);
    }

    const {
      endUserName,
      aka,
      phone,
      otherPhone,
      contactPerson,
      contactPhone,
      stateBackup,
      lgaBackup,
      addressData, // { fullAddress, street, city, state, country, latitude, longitude }
      salesDate,
      amount,
      amountReceived,
      potQuantity,
      heatRetentionDevice,
      previousStoveType,
      previousStoveOther,
      mealsPerDay,
      cookingFuelSource,
      cookingLocation,
      termsAccepted,
      signature,
      stoveImageId,
      agreementImageId,
    } = body ?? {};

    // Required + format checks
    if (!endUserName || !String(endUserName).trim()) {
      return jsonError("End user name is required", 400);
    }
    if (!contactPerson || !String(contactPerson).trim()) {
      return jsonError("Contact person is required", 400);
    }
    if (!isValidNgPhone(phone)) {
      return jsonError(`End user phone: ${PHONE_FORMAT_MESSAGE}`, 400);
    }
    if (!isValidNgPhone(contactPhone)) {
      return jsonError(`Contact phone: ${PHONE_FORMAT_MESSAGE}`, 400);
    }

    // End-user phone uniqueness (excluding this sale).
    // Skip when the phone is unchanged from the current sale's stored phone.
    //
    // Compare the LAST 10 DIGITS, not the full digit string — "08031234567"
    // and "2348031234567" are the same subscriber. This matters twice here:
    // re-saving a sale in the other notation counts as unchanged (no needless
    // lookup), and a genuine clash in a different notation is caught. Same key
    // as `create-sale`, `get-end-user-phones` and the mobile app; if these
    // drift apart the create and edit paths disagree about what's a duplicate.
    {
      const phoneDigits = String(phone).replace(/\D+/g, "");
      const currentDigits = String(sale.phone ?? "").replace(/\D+/g, "");
      const tail = phoneDigits.slice(-10);
      const currentTail = currentDigits.slice(-10);
      if (phoneDigits && tail !== currentTail) {
        const { data: dupes } = await supabase
          .from("sales")
          .select("id, transaction_id, phone")
          .neq("id", saleId)
          .ilike("phone", `%${tail}%`)
          .limit(100);
        const clash = (dupes ?? []).find((r: { phone: string | null }) => {
          const rowDigits = String(r.phone ?? "").replace(/\D+/g, "");
          return rowDigits.length >= 10 && rowDigits.slice(-10) === tail;
        });
        if (clash) {
          return jsonError(
            `This end user phone is already used on sale ${clash.transaction_id}.`,
            409
          );
        }
      }
    }


    // Update address (if provided and sale has one)
    if (addressData && sale.address_id) {
      const { error: addrErr } = await supabase
        .from("addresses")
        .update({
          full_address: addressData.fullAddress ?? null,
          street: addressData.street ?? null,
          city: addressData.city ?? null,
          state: addressData.state ?? null,
          country: addressData.country ?? null,
          latitude: addressData.latitude ?? null,
          longitude: addressData.longitude ?? null,
        })
        .eq("id", sale.address_id);
      if (addrErr) {
        console.error("Address update failed:", addrErr);
        return jsonError("Failed to update address", 500);
      }
    }

    // Build sale update object — only include fields that were provided so
    // we never accidentally null out untouched columns.
    const saleUpdate: Record<string, unknown> = {
      end_user_name: endUserName,
      aka: aka ?? null,
      phone,
      other_phone: otherPhone ?? null,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      state_backup: stateBackup ?? null,
      lga_backup: lgaBackup ?? null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    if (salesDate !== undefined) saleUpdate.sales_date = salesDate;
    if (amount !== undefined && amount !== null && amount !== "") {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return jsonError("Sale amount must be a positive number", 400);
      }
      saleUpdate.amount = parsed;
    }
    // Mirrors create-sale: what the customer actually paid is stored as
    // `total_paid`, not `amount_received` (no such column on `sales`).
    if (amountReceived !== undefined) {
      saleUpdate.total_paid =
        amountReceived === null || amountReceived === ""
          ? null
          : Number(amountReceived);
    }
    if (potQuantity !== undefined) {
      saleUpdate.pot_quantity =
        potQuantity === null || potQuantity === "" ? null : Number(potQuantity);
    }
    if (heatRetentionDevice !== undefined) saleUpdate.heat_retention_device = !!heatRetentionDevice;
    if (previousStoveType !== undefined) saleUpdate.previous_stove_type = previousStoveType || null;
    if (previousStoveOther !== undefined) saleUpdate.previous_stove_other = previousStoveOther || null;
    if (mealsPerDay !== undefined) saleUpdate.meals_per_day = mealsPerDay || null;
    if (cookingFuelSource !== undefined) saleUpdate.cooking_fuel_source = cookingFuelSource || null;
    if (cookingLocation !== undefined) saleUpdate.cooking_location = cookingLocation || null;
    if (termsAccepted !== undefined) saleUpdate.terms_accepted = termsAccepted;
    if (signature !== undefined && signature !== null && signature !== "") saleUpdate.signature = signature;
    if (stoveImageId !== undefined && stoveImageId !== "") saleUpdate.stove_image_id = stoveImageId || null;
    if (agreementImageId !== undefined && agreementImageId !== "") saleUpdate.agreement_image_id = agreementImageId || null;

    const { data: updated, error: updErr } = await supabase
      .from("sales")
      .update(saleUpdate)
      .eq("id", saleId)
      .select("id")
      .maybeSingle();

    if (updErr || !updated) {
      console.error("Sale update failed:", updErr);
      return jsonError("Failed to update sale", 500);
    }

    return withCors(
      new Response(
        JSON.stringify({ success: true, message: "Sale updated", data: { id: saleId } }),
        { status: 200 }
      )
    );
  } catch (err) {
    console.error("🔥 update-sale error:", err);
    return jsonError("Unexpected error", 500);
  }
});

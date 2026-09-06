// Update the end-user portion of a sale.
// Allowed roles: super_admin, acsl_agent_manager, acsl_agent, partner,
// partner_agent (partner/partner_agent are scoped to their own
// organization_id). Sets updated_at / updated_by.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSaleOptions, normalizeChoice } from "../_shared/sale-options.ts";
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

/** An account id is a uuid or it is not an account id. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /*
   * The service client, with no user header. Authorization is decided below in
   * code: the role list, the partner's own organisation, an ACSL agent's
   * assigned organisations. It used to carry the caller's Authorization header,
   * so every read and write ran under the caller's row policies, and those
   * policies grant an ACSL agent or agent manager nothing by assignment. The
   * sale then came back "not found" for the very people the role list admits,
   * which is how eight of the eleven linked sales reps could not fix a record
   * the call centre sent back (Data Center phase 24, slice 2).
   */
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
      "super_admin_agent",
    ];
    if (!ALLOWED.includes(profile.role)) {
      return jsonError("You do not have permission to edit sales", 403);
    }

    // Load current sale (need address_id + organization_id for scoping, plus
    // every status-relevant column so `status` can be recomputed against the
    // merged before/after picture — some of these are immutable here).
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .select(
        `id, organization_id, address_id, phone, created_by,
         transaction_id, stove_serial_no, partner_name, sales_date, amount,
         contact_person, contact_phone, end_user_name, state_backup, lga_backup,
         signature, is_installment, total_paid,
         previous_stove_type, cooking_fuel_source, cooking_location,
         address:addresses!left(full_address)`
      )
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
    // A partner agent edits the sales they recorded. Under the old row
    // policies that was the only update the database let through for the
    // role; the service client would have widened it to the whole partner,
    // which nobody asked for.
    if (profile.role === "partner_agent" && sale.created_by !== userId) {
      return jsonError("You can only edit sales you recorded", 403);
    }
    // ACSL agents and managers edit the partners assigned to them (directly,
    // by state, or through their team), the same rule the read paths apply.
    if (
      profile.role === "acsl_agent" ||
      profile.role === "acsl_agent_manager" ||
      profile.role === "super_admin_agent"
    ) {
      const assigned = await resolveAssignedOrgIds(supabase, userId);
      if (!assigned.assignedOrgIds.includes(String(sale.organization_id))) {
        return jsonError("You can only edit sales for the partners assigned to you", 403);
      }
    }

    const {
      endUserName,
      // The agreement's two name fields, and the agent who sold the stove.
      // Sparse like every other optional key here: a body that does not
      // mention one leaves the column alone.
      endUserFirstName,
      endUserSurname,
      salesAgentName,
      salesAgentUserId,
      retailerBranch,
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

    // The buyer's name, in whichever form arrived. A caller that sends the two
    // parts and no joined name satisfies the requirement with their join, the
    // same value the database trigger would compose. `undefined` is kept
    // distinct from an emptied field so an absent key writes nothing.
    const endUserFirstNameClean = endUserFirstName === undefined
      ? undefined
      : String(endUserFirstName ?? "").trim() || null;
    const endUserSurnameClean = endUserSurname === undefined
      ? undefined
      : String(endUserSurname ?? "").trim() || null;
    const endUserNameJoined = String(endUserName ?? "").trim() ||
      [endUserFirstNameClean, endUserSurnameClean].filter(Boolean).join(" ");

    // Required + format checks
    if (!endUserNameJoined) {
      return jsonError("End user name is required", 400);
    }
    // The contact pair is optional since A4: the customer is the contact
    // when it is empty. A phone given is still a phone.
    if (!isValidNgPhone(phone)) {
      return jsonError(`End user phone: ${PHONE_FORMAT_MESSAGE}`, 400);
    }
    if (contactPhone && String(contactPhone).trim() && !isValidNgPhone(contactPhone)) {
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
      // Only the keys sent are written. A body carrying fullAddress alone
      // corrects the text and leaves street, city, country and the
      // coordinates as they were, rather than nulling them.
      const addressUpdate: Record<string, unknown> = {};
      const addressKeys: [string, string][] = [
        ["fullAddress", "full_address"],
        ["street", "street"],
        ["city", "city"],
        ["state", "state"],
        ["country", "country"],
        ["latitude", "latitude"],
        ["longitude", "longitude"],
      ];
      for (const [from, to] of addressKeys) {
        if (addressData[from] !== undefined) addressUpdate[to] = addressData[from] ?? null;
      }
      const { error: addrErr } = Object.keys(addressUpdate).length === 0
        ? { error: null }
        : await supabase
          .from("addresses")
          .update(addressUpdate)
          .eq("id", sale.address_id);
      if (addrErr) {
        console.error("Address update failed:", addrErr);
        return jsonError("Failed to update address", 500);
      }
    }

    // Build sale update object — only include fields that were provided so
    // we never accidentally null out untouched columns.
    const saleUpdate: Record<string, unknown> = {
      end_user_name: endUserNameJoined,
      phone,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    // Written only when sent. The host's edit form sends all four every time;
    // a partial body (the Data Center's correction workspace sends the fields
    // it changed) must not null what it did not mention.
    if (endUserFirstNameClean !== undefined) {
      saleUpdate.end_user_first_name = endUserFirstNameClean;
    }
    if (endUserSurnameClean !== undefined) {
      saleUpdate.end_user_surname = endUserSurnameClean;
    }
    if (salesAgentName !== undefined) {
      saleUpdate.selling_agent_name = String(salesAgentName ?? "").trim() || null;
      // A name given without an account is a different person until an
      // account is named too; the old id must not point at the new name.
      if (salesAgentUserId === undefined) saleUpdate.selling_agent_user_id = null;
    }
    if (salesAgentUserId !== undefined) {
      const candidate = String(salesAgentUserId ?? "").trim();
      if (candidate === "") {
        saleUpdate.selling_agent_user_id = null;
      } else if (!UUID_RE.test(candidate)) {
        return jsonError("Sales agent user ID must be a user id", 400);
      } else {
        saleUpdate.selling_agent_user_id = candidate;
      }
    }
    if (retailerBranch !== undefined) saleUpdate.retailer_branch = retailerBranch || null;
    if (aka !== undefined) saleUpdate.aka = aka ?? null;
    if (otherPhone !== undefined) saleUpdate.other_phone = otherPhone ?? null;
    if (stateBackup !== undefined) saleUpdate.state_backup = stateBackup ?? null;
    if (lgaBackup !== undefined) saleUpdate.lga_backup = lgaBackup ?? null;
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
      if (amountReceived === null || amountReceived === "") {
        saleUpdate.total_paid = null;
      } else {
        const parsedReceived = Number(amountReceived);
        if (!Number.isFinite(parsedReceived) || parsedReceived < 0) {
          return jsonError("Amount received must be a positive number", 400);
        }
        saleUpdate.total_paid = parsedReceived;
      }
    }
    // Keep the payment columns coherent with the amount. A non-installment sale
    // is a full payment by definition, so its `total_paid` tracks the sale
    // amount; an installment may sit part paid. Without this an edit to the
    // amount would leave `total_paid`/`payment_status` describing the old
    // figure; see the matching rule in create-sale.
    // This only runs when the edit ACTUALLY moves one of the figures. The edit
    // forms resend the whole sale on every save, so applying it unconditionally
    // would rewrite `total_paid` on legacy part-paid outright sales during an
    // unrelated edit (a phone-number fix, say). Historical rows are left exactly
    // as they are unless someone deliberately touches the money.
    // (Reconciled from the deployed v20 on 2026-09-04; see DRIFT.md.)
    const amountsChanged =
      (Object.prototype.hasOwnProperty.call(saleUpdate, "amount") &&
        Number(saleUpdate.amount) !== Number(sale.amount)) ||
      (Object.prototype.hasOwnProperty.call(saleUpdate, "total_paid") &&
        Number(saleUpdate.total_paid ?? 0) !== Number((sale as { total_paid?: unknown }).total_paid ?? 0));
    if (amountsChanged) {
      const effectiveAmount = Number(
        Object.prototype.hasOwnProperty.call(saleUpdate, "amount") ? saleUpdate.amount : sale.amount,
      );
      if ((sale as { is_installment?: boolean }).is_installment) {
        const effectivePaid = Number(
          Object.prototype.hasOwnProperty.call(saleUpdate, "total_paid")
            ? saleUpdate.total_paid ?? 0
            : (sale as { total_paid?: unknown }).total_paid ?? 0,
        );
        if (effectivePaid > effectiveAmount) {
          return jsonError("Amount received cannot be greater than the sales amount", 400);
        }
        saleUpdate.payment_status = effectivePaid >= effectiveAmount ? "fully_paid" : "partially_paid";
      } else {
        saleUpdate.total_paid = effectiveAmount;
        saleUpdate.payment_status = "fully_paid";
      }
    }
    if (potQuantity !== undefined) {
      saleUpdate.pot_quantity =
        potQuantity === null || potQuantity === "" ? null : Number(potQuantity);
    }
    if (heatRetentionDevice !== undefined) saleUpdate.heat_retention_device = !!heatRetentionDevice;
    // The three choices come from the registry (slice F3b); see create-sale.
    const optionLists =
      previousStoveType !== undefined || cookingFuelSource !== undefined || cookingLocation !== undefined
        ? await loadSaleOptions(supabase)
        : null;
    if (previousStoveType !== undefined) {
      // A record re-saved with the value it already holds keeps it, retired or not.
      const c = normalizeChoice(optionLists, "baseline_stove", previousStoveType, {
        allowRetired: String(previousStoveType ?? "") === String((sale as { previous_stove_type?: string | null }).previous_stove_type ?? ""),
      });
      saleUpdate.previous_stove_type = c.value;
      // A placed value carries no description unless one was sent; the words
      // nothing could place become the description.
      if (previousStoveOther === undefined) {
        saleUpdate.previous_stove_other = c.value === null ? c.note : null;
      }
    }
    if (previousStoveOther !== undefined) saleUpdate.previous_stove_other = previousStoveOther || null;
    if (mealsPerDay !== undefined) saleUpdate.meals_per_day = mealsPerDay || null;
    if (cookingFuelSource !== undefined) {
      const c = normalizeChoice(optionLists, "fuel_source", cookingFuelSource, {
        allowRetired: String(cookingFuelSource ?? "") === String((sale as { cooking_fuel_source?: string | null }).cooking_fuel_source ?? ""),
      });
      saleUpdate.cooking_fuel_source = c.value;
      if (c.matched !== "unchecked") saleUpdate.cooking_fuel_source_note = c.note;
    }
    if (cookingLocation !== undefined) {
      const c = normalizeChoice(optionLists, "cooking_location", cookingLocation, {
        allowRetired: String(cookingLocation ?? "") === String((sale as { cooking_location?: string | null }).cooking_location ?? ""),
      });
      saleUpdate.cooking_location = c.value;
      if (c.matched !== "unchecked") saleUpdate.cooking_location_note = c.note;
    }
    if (termsAccepted !== undefined) {
      // The same rule create-sale applies: the agreement carries six consents
      // and a sale carries all of them or none. A partial object is refused
      // rather than written over the consents already given.
      const requiredConsents = ["poaGoverned", "monitoring", "noResell", "emissionReductions", "noExport", "demonstration"];
      if (!termsAccepted || typeof termsAccepted !== "object") {
        return jsonError("Terms & conditions must be accepted", 400);
      }
      const missingConsents = requiredConsents.filter((key) => (termsAccepted as Record<string, unknown>)[key] !== true);
      if (missingConsents.length > 0) {
        return jsonError(`All terms & conditions must be accepted (missing: ${missingConsents.join(", ")})`, 400);
      }
      saleUpdate.terms_accepted = termsAccepted;
    }
    if (signature !== undefined && signature !== null && signature !== "") saleUpdate.signature = signature;
    if (stoveImageId !== undefined && stoveImageId !== "") saleUpdate.stove_image_id = stoveImageId || null;
    if (agreementImageId !== undefined && agreementImageId !== "") saleUpdate.agreement_image_id = agreementImageId || null;

    // Recompute completeness from the merged before/after state. Without this a
    // sale saved as incomplete would stay incomplete forever, even once the
    // missing fields were supplied — see _shared/saleStatus.ts.
    // The status is the trigger's to set on this update: update_sale_status()
    // applies public.calculate_sale_status, which reads public.sale_field_rules.

    const { data: updated, error: updErr } = await supabase
      .from("sales")
      .update(saleUpdate)
      .eq("id", saleId)
      .select("id, status")
      .maybeSingle();

    if (updErr || !updated) {
      console.error("Sale update failed:", updErr);
      return jsonError("Failed to update sale", 500);
    }

    return withCors(
      new Response(
        JSON.stringify({ success: true, message: "Sale updated", status: (updated as { status?: string }).status ?? null, data: { id: saleId } }),
        { status: 200 }
      )
    );
  } catch (err) {
    console.error("🔥 update-sale error:", err);
    return jsonError("Unexpected error", 500);
  }
});

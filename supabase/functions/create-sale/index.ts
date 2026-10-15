import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSaleOptions, normalizeChoice } from "../_shared/sale-options.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";
import { buyerKey, phoneTail } from "../_shared/buyerKey.ts";

function withCors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res;
}

function jsonError(
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return withCors(
    new Response(JSON.stringify({ success: false, message, ...extra }), { status })
  );
}

/**
 * The refusal for the same customer entered twice. Read as it is on the phone
 * app's pending card, so it says what happened and what to do. It must never
 * contain "transaction id": the phone app reads "transaction id" plus "already
 * exists" as "this sale already saved", and the Data Center import retries any
 * refusal mentioning "transaction id".
 */
function sameBuyerMessage(otherTransactionId: string | null): string {
  // Named only when the caller may see that sale; otherwise it is not
  // identified at all.
  const other = otherTransactionId ? `sale ${otherTransactionId}` : "another sale";
  return (
    `Not saved: this customer (same name and phone number) is already registered on ${other}. ` +
    "The same customer cannot be recorded twice. Check the name and phone number. " +
    "If they are correct, this sale is a duplicate and does not need to be saved."
  );
}

/** An account id is a uuid or it is not an account id. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  console.log("➡️ Incoming request:", req.method, req.url);

  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  // Carries the caller's own login, so the database sees who is selling: its
  // reads (the caller's profile, duplicate checks, payment models) run under
  // the caller's row policies. Despite the service
  // key, a forwarded Authorization header makes PostgREST act as the caller.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    }
  );
  /*
   * The server's own client, with no caller attached. It makes every write
   * to addresses, sales, stove_ids and installment_payments: the buyer's
   * address, the sale itself, the stove claim, undoing this function's own
   * sale when the claim does not happen, and the first instalment. The caller has been authenticated and the
   * organisation resolved from their profile or checked against their
   * assignments before any of them runs, and created_by and recorded_by are
   * set from that caller, so the sale history still names them.
   *
   * Stove rows are written by the server only since 2026-09-24
   * (20260924234000_stove_ids_writes_server_only): signed-in users lost
   * UPDATE on stove_ids. The claim ran on the client above, as the caller, so
   * from that moment every create-sale from Sell Stove, the phone app and the
   * Data Center's commit failed at the claim with "Failed to update
   * stove_ids", and left the sale it had just inserted behind (D62). The
   * caller has already been authenticated and scoped to the organisation by
   * the time either write runs, and the claim is filtered by that
   * organisation, so running it as the server widens nothing.
   */
  const server = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
      // The agreement's two name fields, and the agent who sold the stove.
      // A writer may send either name form; the database keeps the two in
      // step. See 20260908050000_sale_record_fields_from_agreement.sql.
      endUserFirstName,
      endUserSurname,
      salesAgentName,
      salesAgentUserId,
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

    /**
     * One household, one number, two stoves.
     *
     * The rule below is one live sale per phone, and it is right for the Sell
     * Stove form: an agent standing in front of a customer who types a number
     * already on file has almost certainly typed the wrong number. It is wrong
     * for a digitiser working through a stack of receipts, where a man who
     * bought stoves for two wives wrote the same number on both.
     *
     * So the rule stays, and the Data Center's digitalisation path - and only
     * that path - can say it means it. The Sell Stove form and the mobile app
     * never send this field, so nothing about them changes.
     *
     * `allowSharedPhone` does not skip the check. It turns the refusal into a
     * report, so the caller learns which sales already hold the number and can
     * record the sharing rather than discovering it later.
     */
    const allowSharedPhone = body.allowSharedPhone === true;

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
      .select("organization_id, role, full_name")
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

    // ── The buyer's name, in whichever form arrived ───────────────────────────
    //
    // The paper agreement carries First name and Surname; older callers (the
    // phone app, anything written before this) carry only the joined name. The
    // BEFORE trigger on `sales` reconciles the two whichever way round they
    // come, so both forms are accepted here.
    //
    // The join is composed BEFORE the required-field check and the status rule
    // below, so a caller that sent only the parts satisfies both exactly as a
    // caller that sent the joined name does. Nothing downstream sees a
    // difference.
    const endUserFirstNameClean = String(endUserFirstName ?? "").trim() || null;
    const endUserSurnameClean = String(endUserSurname ?? "").trim() || null;
    const endUserNameJoined =
      String(endUserName ?? "").trim() ||
      [endUserFirstNameClean, endUserSurnameClean].filter(Boolean).join(" ");

    // The agent who sold the stove, as written on the agreement, and their
    // account when they have one. Not the typist: `created_by` keeps naming
    // whoever made the record.
    // A caller that says nothing about the agent (the phone app until it is
    // updated) made the sale itself, so the creator is the agent, as the
    // backfill read history. A caller that sends the key, even as null (the
    // import, whose sheet may leave it blank), is believed.
    const creatorName = String((profile as { full_name?: string | null } | null)?.full_name ?? "").trim() || null;
    const sellingAgentName = salesAgentName === undefined
      ? creatorName
      : String(salesAgentName ?? "").trim() || null;
    let sellingAgentUserId: string | null = null;
    if (
      salesAgentUserId !== undefined &&
      salesAgentUserId !== null &&
      String(salesAgentUserId).trim() !== ""
    ) {
      const candidate = String(salesAgentUserId).trim();
      if (!UUID_RE.test(candidate)) {
        return jsonError("Sales agent user ID must be a user id", 400);
      }
      sellingAgentUserId = candidate;
    }

    // ── Required-field validation ─────────────────────────────────────────────
    // Reject with a field-specific message rather than silently writing a row.
    const isBlank = (v: unknown) =>
      v === null || v === undefined || String(v).trim() === "";

    const requiredFieldChecks: Array<[unknown, string]> = [
      [transactionId, "Transaction ID is required"],
      [salesDate, "Sales date is required"],
      [endUserNameJoined, "End user name is required"],
      [phone, "Phone number is required"],
      [partnerName, "Partner name is required"],
      [stoveSerialNo, "Stove serial number is required"],
    ];
    for (const [value, message] of requiredFieldChecks) {
      if (isBlank(value)) {
        return jsonError(message, 400);
      }
    }

    // ── A sale cannot have happened tomorrow ──────────────────────────────────
    //
    // The Sell Stove form already caps its date input at today, but that is a
    // `max` attribute: it stops the picker, not the request. The mobile app and
    // every import path reach this function directly, and nothing here checked,
    // so a future date could be written by anything that was not the web form.
    //
    // It matters because dates are what everything downstream ages against.
    // Three stoves reached production carrying ERP transfer dates in November
    // and December 2026 and read as brand-new stock while being months old; a
    // future SALE date would do the same to the call queue and to every
    // creditable figure computed from it.
    //
    // Compared in Africa/Lagos, not UTC. Lagos is an hour ahead, so a sale
    // entered at half past midnight is already tomorrow locally while the
    // server still calls it today - and a UTC comparison would refuse a
    // perfectly ordinary evening sale.
    //
    // Historical dates stay welcome. The whole point of digitalisation is
    // typing in receipts from months ago, and the stock cutoff was removed in
    // the same change precisely so the past stays visible.
    {
      const salesDateText = String(salesDate).trim().slice(0, 10);
      const todayInLagos = new Date().toLocaleDateString("en-CA", {
        timeZone: "Africa/Lagos",
      });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(salesDateText)) {
        return jsonError("Sales date must be a date, as YYYY-MM-DD", 400);
      }
      if (salesDateText > todayInLagos) {
        return jsonError(
          `Sales date ${salesDateText} is in the future. A sale cannot be recorded before it happens; today is ${todayInLagos}.`,
          400,
        );
      }
    }

    // ── Duplicate transaction ID ──────────────────────────────────────────────
    // Checked before the phone, on purpose. The phone app retries a queued sale
    // whose reply was lost on a weak network, with the same transaction id. If
    // that sale did save, this is the answer the app recognises as "already
    // saved" (409, "transaction ID ... already exists") and clears from its
    // queue. With the phone checked first, the retry was refused as a duplicate
    // customer instead and stayed queued on the device for good.
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

    // A number too short to be a phone is refused here; the shared-number and
    // same-customer check runs last, just before anything is written (below).
    if (String(phone).replace(/\D+/g, "").length < 7) {
      return jsonError("End user phone number is invalid", 400);
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

      // Sales models are tied to a partner again, sourced from the external
      // sync (`Partner Sales Models`) rather than assigned by a super admin.
      // The clients already filter the picker to the partner's models; this is
      // the server-side enforcement that makes that filtering real.
      //
      // A partner with NO assignments may use EVERY active model. The sync only
      // covers partners the external app has sent, so treating "none assigned"
      // as "no entitlement" would block sales for every unsynced partner rather
      // than protect them. Only a partner with an explicit list is restricted
      // to that list.
      //
      // The whole list is fetched rather than probing for one link so a failed
      // lookup is distinguishable from a genuine "not assigned" — the first is
      // a 500, not a spurious 403. This must stay in step with
      // `visiblePaymentModels` in both clients; if they diverge, the picker
      // offers models this endpoint then rejects.
      const { data: orgModelLinks, error: linkError } = await supabase
        .from("organization_payment_models")
        .select("payment_model_id")
        .eq("organization_id", organizationId);

      if (linkError) {
        console.error("❌ Payment model assignment lookup failed:", linkError.message);
        return jsonError("Could not verify the partner's sales models", 500);
      }

      const assignedIds = (orgModelLinks || []).map((l: any) => l.payment_model_id);

      if (assignedIds.length > 0 && !assignedIds.includes(paymentModelId)) {
        return jsonError(
          `This partner is not assigned the "${paymentModel.name}" sales model`,
          403,
        );
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
    // and cannot exceed the sales amount. For outright (non-installment) sales
    // this is the ONLY record of what was collected — it is persisted below as
    // `total_paid`.
    let outrightPaid = 0;
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
      outrightPaid = parsedReceived;
    }

    // A non-installment sale IS a full payment by definition — the customer
    // settles the whole amount up front. The clients collect a single figure
    // and send it as both `amount` and `amountReceived`, so the two already
    // agree. We coerce rather than reject so that older app builds, and sales
    // queued offline before the clients were updated, still sync instead of
    // failing forever. Anything genuinely part-paid belongs on a payment model.
    if (!installmentData && outrightPaid !== saleAmount) {
      console.warn(
        `⚠️ Outright sale received ${outrightPaid} against amount ${saleAmount} — ` +
          `coercing to full payment (non-installment sales are paid in full).`,
      );
      outrightPaid = saleAmount;
    }

    // Stove image is now OPTIONAL (previously rejected when missing). The sale
    // is still accepted; it simply won't reach "completed" status without it
    // (see status evaluation below). Normalize empty string to null so the uuid
    // column doesn't reject "" with a 22P02 error.
    const safeStoveImageId =
      stoveImageId && String(stoveImageId).trim() !== ""
        ? stoveImageId
        : null;
    // Agreement image is optional — normalize empty string to null so the
    // uuid column doesn't reject "" with a 22P02 error.
    const safeAgreementImageId =
      agreementImageId && String(agreementImageId).trim() !== ""
        ? agreementImageId
        : null;

    // ── One customer, one record; one phone, several buyers ───────────────────
    // The rule (docs/plans/phone-and-buyer-rule.md): a household shares a phone,
    // so a number already on another sale is allowed when the buyer's name is
    // different, and reported back so the sharing is noted. The same name on the
    // same number is the same customer entered twice, and is refused. Names are
    // compared by buyer key (_shared/buyerKey.ts), so order, case, titles and an
    // alias in brackets do not make one customer look like two.
    //
    // Looked up as the server, across every partner, through the phone tail
    // index; cancelled sales do not count. The Data Center's digitisation
    // (`allowSharedPhone`) is never refused: a receipt records a stove already
    // sold, so a repeat buyer there is saved and marked `same_buyer` for the call
    // centre to confirm.
    //
    // The rule is global, but what the caller is TOLD is not: a sale is named
    // (its id and transaction id) only when the caller's own access already
    // lets them read it, which is all the old caller-scoped check ever showed.
    // A same-customer match the caller cannot see is still refused, with
    // "another sale" in place of a name. Run last, after the stove and the
    // payment checks, so asking about a number takes a real free stove of the
    // caller's own, and a refusal writes nothing.
    //
    // A failed lookup lets the sale through, as before: refusing every sale when
    // the lookup hiccups would be worse than missing a rare repeat.
    let sharesPhoneWith: { id: string; transaction_id: string | null; same_buyer: boolean }[] = [];
    // Every live sale on the number, whoever may see it: what the register
    // is written from once the sale has saved (Phase 4).
    let othersOnNumber: { id: string; same_buyer: boolean }[] = [];
    {
      const tail = phoneTail(phone);
      if (tail) {
        const { data: others, error: shareErr } = await server.rpc("sales_sharing_phone", {
          p_tail: tail,
        });
        if (shareErr) {
          console.error("Shared-phone lookup failed:", shareErr.message);
        } else if (others && others.length > 0) {
          type Other = {
            id: string;
            transaction_id: string | null;
            phone: string | null;
            end_user_name: string | null;
            end_user_first_name: string | null;
            end_user_surname: string | null;
          };
          const mine = await buyerKey(phone, endUserFirstNameClean, endUserSurnameClean, endUserNameJoined);
          const marked = await Promise.all(
            (others as Other[]).map(async (o) => ({
              id: o.id,
              transaction_id: o.transaction_id,
              same_buyer:
                mine !== "" &&
                (await buyerKey(o.phone, o.end_user_first_name, o.end_user_surname, o.end_user_name)) === mine,
            })),
          );
          // Which of them the caller may see, by their own row rules.
          const { data: seen, error: seenErr } = await supabase
            .from("sales")
            .select("id")
            .in("id", marked.map((m) => m.id));
          if (seenErr) console.error("Visibility read failed:", seenErr.message);
          const visible = new Set((seen ?? []).map((r: { id: string }) => r.id));

          const sameBuyer = marked.find((m) => m.same_buyer);
          if (sameBuyer && !allowSharedPhone) {
            const named = visible.has(sameBuyer.id) ? sameBuyer.transaction_id : null;
            return jsonError(sameBuyerMessage(named), 409, {
              code: "SAME_BUYER_SAME_PHONE",
              transactionId: named,
            });
          }
          sharesPhoneWith = marked.filter((m) => visible.has(m.id));
          othersOnNumber = marked.map((m) => ({ id: m.id, same_buyer: m.same_buyer }));
        }
      }
    }

    // ── Insert address ────────────────────────────────────────────────────────
    console.log("📍 Inserting address:", addressData);
    // As the server: since 20260926170000 only super admins may insert into
    // addresses, so an address written as the caller was refused for every
    // other role, and the sale with it ("Address save failed").
    const { data: address, error: addressError } = await server
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

    // ── Insert sale ───────────────────────────────────────────────────────────
    // The three choices come from the registry (slice F3b). A value, a label,
    // an older value or free text is placed on the list where it can be; what
    // cannot be placed keeps its words in the note column.
    const optionLists = await loadSaleOptions(supabase);
    const stoveChoice = normalizeChoice(optionLists, "baseline_stove", previousStoveType);
    const fuelChoice = normalizeChoice(optionLists, "fuel_source", cookingFuelSource);
    const locationChoice = normalizeChoice(optionLists, "cooking_location", cookingLocation);

    // The status is the trigger's to set: update_sale_status() applies
    // public.calculate_sale_status, which reads public.sale_field_rules.
    console.log("📝 Inserting main sale");
    const { data: saleInsertData, error: saleError } = await server
      .from("sales")
      .insert([
        {
          transaction_id: transactionId,
          stove_serial_no: stoveSerialNo,
          sales_date: salesDate,
          contact_person: contactPerson,
          contact_phone: contactPhone,
          end_user_name: endUserNameJoined,
          // Written only when a part actually arrived. A caller sending the
          // joined name alone leaves these to the trigger, which splits it by
          // rule and says so in name_split_source.
          ...(endUserFirstNameClean || endUserSurnameClean
            ? {
              end_user_first_name: endUserFirstNameClean,
              end_user_surname: endUserSurnameClean,
            }
            : {}),
          selling_agent_name: sellingAgentName,
          selling_agent_user_id: sellingAgentUserId,
          aka,
          state_backup: stateBackup,
          lga_backup: lgaBackup,
          phone,
          other_phone: otherPhone,
          partner_name: partnerName,
          retailer_branch: retailerBranch || null,
          amount: saleAmount,
          signature,
          created_by: userId,
          organization_id: organizationId,
          address_id: address.id,
          stove_image_id: safeStoveImageId,
          agreement_image_id: safeAgreementImageId,
          is_installment: !!installmentData,
          payment_model_id: installmentData?.modelId || null,
          // total_paid always reflects what was actually collected, for both
          // installment and outright sales — never the sale price.
          total_paid: installmentData ? installmentData.totalPaid : outrightPaid,
          // Outright sales are always fully paid (coerced above); only
          // installments can land here partially paid.
          payment_status: installmentData ? installmentData.paymentStatus : "fully_paid",
          pot_quantity: potQuantity ?? null,
          heat_retention_device: heatRetentionDevice ?? false,
          previous_stove_type: stoveChoice.value,
          // The description as typed, or the words nothing could place; a placed
          // value carries no note, so nothing is orphaned behind it.
          previous_stove_other: previousStoveOther || (stoveChoice.value === null ? stoveChoice.note : null) || null,
          meals_per_day: mealsPerDay || null,
          cooking_fuel_source: fuelChoice.value,
          cooking_fuel_source_note: fuelChoice.note,
          cooking_location: locationChoice.value,
          cooking_location_note: locationChoice.note,
          terms_accepted: termsAccepted ?? null,
        },
      ])
      .select("id, status")
      .maybeSingle();

    if (saleError || !saleInsertData?.id) {
      console.error("❌ Sales insert failed:", saleError);
      return jsonError("Sales save failed", 500);
    }

    const saleId = saleInsertData.id;
    // The verdict the trigger wrote, returned to the caller as before.
    const saleStatus = (saleInsertData as { status?: string }).status ?? "incomplete";
    console.log("✅ Sale inserted:", saleId);

    // ── Claim the stove ───────────────────────────────────────────────────────
    //
    // The `status <> sold` filter is what makes this a claim rather than an
    // announcement, and it is the whole fix.
    //
    // Without it the sequence was: read the stove's status, insert the sale,
    // then mark the stove sold unconditionally. Two people selling the same
    // stove at the same moment both read `available`, both inserted a sale, and
    // the second overwrote the first's sale_id. One stove, two sales, and
    // stock remembering only one of them. Reproduced with two concurrent
    // requests before this change.
    //
    // Now the filter is evaluated by Postgres as part of the UPDATE, so exactly
    // one of the two can match. The other gets zero rows back and undoes its
    // own sale below.
    //
    // `neq("sold")` rather than `eq("available")` on purpose: it mirrors the
    // precondition already checked above, so a stove in some future status
    // that is not `sold` keeps behaving exactly as it does today.
    const { data: claimedStoves, error: stoveUpdateError } = await server
      .from("stove_ids")
      .update({ status: "sold", sale_id: saleId })
      .eq("stove_id", stoveSerialNo)
      .eq("organization_id", organizationId)
      .neq("status", "sold")
      .select("stove_id");

    /*
     * A sale whose stove was not claimed is removed, whatever the reason.
     *
     * Nothing references it yet: the stove was never linked, and installment
     * payments are recorded after this point. Nor does it leave a history:
     * sales_history cascades away with the sale, and the delete trigger writes
     * a row only when it can name an actor, which the server cannot give it.
     * That was as true of the old rollback as of this one. The warning logged
     * below is the record that a sale was made and undone.
     * This used to run only when another sale won the race; a claim that
     * errored returned 500 and left the sale standing, which is how the
     * sandbox collected seven stoveless sales in one morning (D62). It runs
     * as the server because undoing this function's own insert is not a
     * decision the caller's rights should be able to refuse.
     */
    const undoSale = async (why: string) => {
      console.warn(`⚠️ ${why} Rolling back sale ${saleId}.`);
      const { error: rollbackError } = await server
        .from("sales")
        .delete()
        .eq("id", saleId);
      if (rollbackError) {
        // Worth shouting about: a sale with no stove is now sitting in the
        // table. The caller still gets told their sale did not go through,
        // which is the true answer.
        console.error(
          "❌ Could not roll back the orphaned sale:",
          saleId,
          rollbackError.message
        );
      }
    };

    if (stoveUpdateError) {
      console.error("❌ Failed to update stove_ids:", stoveUpdateError);
      await undoSale(`The claim on stove ${stoveSerialNo} failed.`);
      return jsonError("Failed to update stove_ids", 500);
    }

    if (!claimedStoves || claimedStoves.length === 0) {
      // Somebody claimed this stove between the check above and here, so the
      // sale just inserted would be a second sale for a stove that already
      // has one.
      await undoSale(`Stove ${stoveSerialNo} was claimed by another sale first.`);
      return jsonError(
        `Stove serial number "${stoveSerialNo}" was sold by someone else moments ago. Please choose another stove.`,
        409
      );
    }

    console.log("✅ Sales saved and stove_ids updated with sale_id:", saleId);

    // ── Record initial installment payment (if any) ─────────────────────────
    if (installmentData && installmentData.initialAmount > 0) {
      console.log("💰 Recording initial installment payment:", installmentData.initialAmount);
      const { error: paymentError } = await server
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

    /*
     * The call centre's register (Phase 4, decision 1 of 2026-10-15). A sale
     * on a number other live sales hold goes on data_center.shared_phones with
     * every other sale on it, both ends, unconfirmed, so it is held from the
     * creditable count until a call confirms it. The same customer twice
     * (only digitisation gets that far) is marked same_buyer on both sides.
     *
     * After the reply, so the seller never waits for it. A failure is logged
     * and costs only the register row: the sale stands, the stove record
     * still shows the sharing, and the Phase 5 job can write it again.
     */
    if (othersOnNumber.length > 0) {
      const sameBuyerIds = othersOnNumber.filter((o) => o.same_buyer).map((o) => o.id);
      const register = server
        .rpc("register_shared_phone", {
          p_sale_id: saleId,
          p_same_buyer_ids: sameBuyerIds.length > 0 ? [saleId, ...sameBuyerIds] : [],
          p_source: allowSharedPhone ? "digitalisation" : "sales_app",
          p_actor: userId,
        })
        .then(({ error }) => {
          if (error) console.error("Shared-phone register failed:", error.message);
        });
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(register);
      else await register;
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          message: "Sales saved successfully",
          status: saleStatus,
          sale_id: saleId,
          data: { id: saleId },
          /*
            Named only when the number is on other live sales: the sales it is
            shared with, and whether each is the same buyer (only possible for
            the Data Center's digitisation, since anyone else is refused).
            The Data Center reads this to register the sharing; the web form
            reads it to say the shared number was noted. A sale on an unshared
            number gets exactly the response it always did.
          */
          ...(sharesPhoneWith.length > 0
            ? {
              shares_phone_with: sharesPhoneWith.map((r) => ({
                sale_id: r.id,
                transaction_id: r.transaction_id,
                same_buyer: r.same_buyer,
              })),
            }
            : {}),
        }),
        { status: 200 }
      )
    );
  } catch (err) {
    console.error("🔥 Unexpected Error:", err);
    return jsonError("Unexpected error", 500);
  }
});

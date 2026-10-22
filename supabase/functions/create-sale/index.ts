import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSaleOptions, normalizeChoice } from "../_shared/sale-options.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";
import { buyerKey, phoneTail } from "../_shared/buyerKey.ts";
import { withReadConnection } from "../_shared/data-center-db.ts";
import { featuresFor } from "../_shared/data-center-roles.ts";

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

/**
 * Whether this user may commit Data Center imports: the same rule the import
 * applies to itself (an access level plus direct grants, import.commit never
 * implied). Only the import's digitalisation path may share a phone number.
 */
const importerCache = new Map<string, { may: boolean; until: number }>();

async function mayCommitImports(userId: string): Promise<boolean> {
  // An import sends every row through here, so the answer is kept for a minute
  // rather than opening a database connection per row.
  const cached = importerCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.may;
  try {
    const may = await withReadConnection(async (conn) => {
      const r = await conn.queryObject<{ access_role: string | null; keys: string[] | null }>({
        text: `select
                 (select access_role from data_center.module_access where user_id = $1) as access_role,
                 (select coalesce(array_agg(feature_key), '{}')
                    from data_center.feature_grants where user_id = $1) as keys`,
        args: [userId],
      });
      const accessRole = r.rows[0]?.access_role ?? null;
      if (!accessRole) return false;
      return featuresFor(accessRole, r.rows[0]?.keys ?? []).includes("import.commit");
    });
    importerCache.set(userId, { may, until: Date.now() + 60_000 });
    return may;
  } catch (err) {
    console.error("❌ Import permission check failed:", err);
    return false;
  }
}

/** The characters every sale's transaction ID is made of. */
const TXN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Six random characters, the same shape as every transaction ID on file. */
function randomTransactionId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TXN_ALPHABET[b % TXN_ALPHABET.length]).join("");
}

/**
 * The ledger takes cash, transfer or pos. Phone builds from before July
 * 2026 send the picker's labels ("Cash", "Bank Transfer", "POS", "Mobile
 * Money"), and a queued sale keeps them after the app updates. Those are
 * placed on the ledger's three; anything else is passed on as sent, and the
 * ledger refuses it.
 */
function ledgerPaymentMethod(sent: unknown): string {
  const m = String(sent ?? "").trim().toLowerCase();
  if (m === "" || m === "cash") return "cash";
  if (m === "pos") return "pos";
  if (/transfer|bank|mobile/.test(m)) return "transfer";
  return String(sent);
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
   * to addresses, sales, stove_ids and installment_payments, through one
   * call to create_sale_tx: the buyer's address, the sale itself, the stove
   * claim and the first instalment, in one transaction. The caller has been authenticated and the
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
    // Honoured only for a caller who may commit Data Center imports (checked
    // below, once the caller is known). From anyone else it is ignored.
    let allowSharedPhone = body.allowSharedPhone === true;

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
      .select("organization_id, role, full_name, status")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("❌ Profile fetch failed:", profileError.message);
      return jsonError("Profile lookup failed", 500);
    }

    // A disabled account sells nothing. The phone app shows this message on
    // the queued sale, so it says what to do.
    if (profile && profile.status !== "active") {
      return jsonError(
        "Not saved: this account is disabled. Ask your partner admin to record the sale.",
        403,
      );
    }

    if (allowSharedPhone && profile?.role !== "super_admin") {
      allowSharedPhone = await mayCommitImports(userId);
      if (!allowSharedPhone) console.warn("⚠️ allowSharedPhone ignored: caller may not commit imports");
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
    //
    // A retry is the same stove sent again. A different stove under an ID that
    // is already taken is a clash, not a retry: the phone app's IDs repeat
    // (they come from the clock alone), and a clash answered with this 409 is
    // read by the app as "already saved" and dropped from its queue, so the
    // sale was lost. A clash now saves under a fresh ID, returned in the reply
    // as transaction_id. A resend of that sale with its old ID clashes again
    // and is then refused by the stove-already-sold check below, so it cannot
    // save twice.
    //
    // Looked up with the server client: under the caller's row policies a
    // clash with another partner's sale was invisible, and the sale saved
    // with a duplicate ID.
    let saleTransactionId = String(transactionId);
    const { data: holders, error: txnLookupError } = await server
      .from("sales")
      .select("stove_serial_no, is_archived")
      .eq("transaction_id", saleTransactionId)
      .limit(10);
    if (txnLookupError) {
      console.error("❌ Transaction ID lookup failed:", txnLookupError.message);
      return jsonError("Could not verify transaction ID uniqueness", 500);
    }
    if (holders && holders.length > 0) {
      // A cancelled sale (is_archived) is not a retry target: its stove may
      // have been released and genuinely sold again.
      const sameStove = holders.some(
        (h) =>
          h.is_archived !== true &&
          String(h.stove_serial_no ?? "").trim() === String(stoveSerialNo).trim(),
      );
      // The resend of a sale that an earlier clash saved under a fresh ID: the
      // same stove, sold by the same account to the same phone number. It gets
      // the same "already exists" answer, so the phone app clears it from its
      // queue instead of showing "stove already sold" for a sale that saved.
      let savedEarlier = false;
      if (!sameStove) {
        const { data: earlier, error: earlierError } = await server
          .from("sales")
          .select("id")
          .eq("stove_serial_no", stoveSerialNo)
          .eq("created_by", userId)
          .eq("phone", phone)
          .or("is_archived.is.null,is_archived.eq.false")
          .limit(1);
        if (earlierError) {
          console.error("❌ Earlier-save lookup failed:", earlierError.message);
          return jsonError("Could not verify transaction ID uniqueness", 500);
        }
        savedEarlier = !!earlier && earlier.length > 0;
      }
      if (sameStove || savedEarlier) {
        return jsonError(
          `A sale with transaction ID "${saleTransactionId}" already exists`,
          409
        );
      }
      let fresh: string | null = null;
      for (let attempt = 0; attempt < 5 && !fresh; attempt++) {
        const candidate = randomTransactionId();
        const { data: taken, error: takenError } = await server
          .from("sales")
          .select("id")
          .eq("transaction_id", candidate)
          .limit(1);
        if (takenError) {
          console.error("❌ Fresh transaction ID lookup failed:", takenError.message);
          return jsonError("Could not verify transaction ID uniqueness", 500);
        }
        if (!taken || taken.length === 0) fresh = candidate;
      }
      if (!fresh) return jsonError("Could not issue a free transaction ID; try again", 500);
      console.warn(`⚠️ Transaction ID ${saleTransactionId} is taken by another stove; saving under ${fresh}`);
      saleTransactionId = fresh;
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
        paymentMethod: ledgerPaymentMethod(initialPaymentMethod),
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

    // ── Save the sale ─────────────────────────────────────────────────────────
    // The address, the sale, the claim on the stove and the first instalment
    // are written by one database function in one transaction
    // (20261022090000_create_sale_in_one_transaction.sql). Either all of them
    // exist afterwards or none does. Written as four requests, a failure
    // partway left an address no sale pointed to, or a sale whose first
    // payment was never recorded while the caller was told it saved.
    //
    // As the server: since 20260926170000 only super admins may insert into
    // addresses, stove rows are written by the server only since
    // 20260924234000, and the function is the service role's alone. The
    // caller has been authenticated and the organisation resolved before
    // this point, and created_by and recorded_by name that caller.
    console.log("📍 Inserting address:", addressData);

    // The three choices come from the registry (slice F3b). A value, a label,
    // an older value or free text is placed on the list where it can be; what
    // cannot be placed keeps its words in the note column.
    const optionLists = await loadSaleOptions(supabase);
    const stoveChoice = normalizeChoice(optionLists, "baseline_stove", previousStoveType);
    const fuelChoice = normalizeChoice(optionLists, "fuel_source", cookingFuelSource);
    const locationChoice = normalizeChoice(optionLists, "cooking_location", cookingLocation);

    // The status is the trigger's to set: update_sale_status() applies
    // public.calculate_sale_status, which reads public.sale_field_rules.
    console.log("📝 Saving the sale in one transaction (create_sale_tx)");
    const { data: saved, error: saveError } = await server.rpc("create_sale_tx", {
      _address: {
        full_address: addressData?.fullAddress,
        street: addressData?.street,
        city: addressData?.city,
        state: addressData?.state,
        country: addressData?.country,
        latitude: addressData?.latitude,
        longitude: addressData?.longitude,
      },
      _sale: {
        transaction_id: saleTransactionId,
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
      // The first instalment, when one was paid. Its failure now fails the
      // sale: total_paid above already counts it, so a sale saved without it
      // disagreed with its own payment ledger.
      _payment: installmentData && installmentData.initialAmount > 0
        ? {
          amount: installmentData.initialAmount,
          payment_method: installmentData.paymentMethod,
          proof_image_id: installmentData.proofImageId,
          recorded_by: userId,
          payment_date: salesDate || new Date().toISOString().split("T")[0],
          notes: "Initial down payment",
        }
        : null,
    });

    if (saveError || !saved?.sale_id) {
      // The stove went to another sale between the check above and the save.
      // Nothing was written.
      if (saveError?.code === "SC409") {
        console.warn(`⚠️ Stove ${stoveSerialNo} was claimed by another sale first. Nothing saved.`);
        return jsonError(
          `Stove serial number "${stoveSerialNo}" was sold by someone else moments ago. Please choose another stove.`,
          409
        );
      }
      const step = String(saveError?.hint ?? "").replace(/^step:/, "");
      console.error(`❌ Sale not saved (step: ${step || "unknown"}):`, saveError);
      if (step === "address") return jsonError("Address save failed", 500);
      if (step === "claim") return jsonError("Failed to update stove_ids", 500);
      if (step === "payment") {
        // A refused payment row (an unknown method or proof image) is the
        // caller's to fix, so the phone shows it with Edit.
        const fixable = /^2[23]/.test(String(saveError?.code ?? ""));
        return jsonError(
          "Not saved: the first payment could not be recorded. Check the payment details and save again.",
          fixable ? 400 : 500,
        );
      }
      return jsonError("Sales save failed", 500);
    }

    const saleId: string = saved.sale_id;
    // The verdict the trigger wrote, returned to the caller as before.
    const saleStatus: string = saved.status ?? "incomplete";
    console.log("✅ Sales saved and stove_ids updated with sale_id:", saleId);
    if (saved.payment_id) console.log("✅ Initial installment payment recorded");

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
    // Asked after every save on a full number, not only when the lookup above
    // found company: two first sales on a new number saved at the same moment
    // each looked alone, and a failed lookup found nothing. The function
    // writes nothing while fewer than two live sales hold the number.
    if (phoneTail(phone)) {
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
          // The ID the sale was saved under. It differs from the one sent only
          // when that one was already taken by another stove (see above).
          transaction_id: saleTransactionId,
          ...(saleTransactionId !== String(transactionId)
            ? { transaction_id_sent: String(transactionId) }
            : {}),
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

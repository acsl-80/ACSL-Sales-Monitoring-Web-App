// Returns ONLY the end-user phone numbers of every sale, as normalized 10-digit
// keys — nothing else.
//
// Why this exists: the mobile app must reject a duplicate end-user phone while
// OFFLINE, which means the whole set has to be cached on the device. Caching
// full sale rows for that would be enormous (20k+ sales); a bare list of digit
// strings is a few hundred KB and loads in one pass.
//
// Deliberately NOT scoped to the caller's organization. Uniqueness is global —
// a phone used by any partner blocks it for every other partner — so a
// per-agent view would let two agents register the same customer. Only phone
// digits are returned, so this exposes no sale, customer, or partner detail
// beyond "this number is taken".
//
// Since the phone and buyer rule (docs/plans/phone-and-buyer-rule.md) a number
// may sit on several sales, and what is refused is the same customer (same name,
// same number) entered again. `data` stays exactly as it was, so phone app
// 1.0.18 keeps working unchanged. Beside it:
//   buyerKeys      one key per live sale the CALLER may read (their own row
//                  rules), never names: the app computes the key for the sale
//                  on screen and compares offline. A repeat on a sale the
//                  caller cannot read is refused by create-sale at sync.
//   buyerKeyRules  { version, titles }: the title list the key drops, served
//                  so it can change without an app release.
//   ETag           a hash of the body. Sent back as If-None-Match, an unchanged
//                  list costs a 304 and no download.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BUYER_KEY_RULES, buyerKey } from "../_shared/buyerKey.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "etag",
};

/** A strong ETag over the exact body sent: the first 16 hex of its SHA-256. */
async function etagOf(body: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  let hex = "";
  for (const b of digest.subarray(0, 8)) hex += b.toString(16).padStart(2, "0");
  return `"${hex}"`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/// Comparison key: last 10 digits. Must match `PhoneUtils.normalizePhone`
/// (mobile) and the digits-only tail comparison in `create-sale`.
function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    // Any authenticated user may read this — every role can create a sale, so
    // every role needs to know which numbers are taken.
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: authError } = await anonClient.auth.getUser();
    if (authError || !userData?.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Page through in slices to stay under PostgREST's row cap. The client
    // makes one call and gets everything; paging is internal.
    const PAGE = 1000;
    const MAX_ROWS = 200_000; // hard stop so a runaway table can't hang the fn
    const seen = new Set<string>();
    let from = 0;
    let scanned = 0;
    let truncated = false;

    while (true) {
      const { data, error } = await supabase
        .from("sales")
        .select("phone")
        .not("phone", "is", null)
        // A fixed order, so pages neither skip nor repeat rows between calls
        // and the same sales always give the same body (and ETag).
        .order("id")
        .range(from, from + PAGE - 1);

      if (error) {
        console.error("❌ Phone fetch failed:", error.message);
        return json({ success: false, error: "Failed to fetch phone numbers" }, 500);
      }

      const rows = data ?? [];
      for (const row of rows) {
        const key = normalizePhone((row as { phone: unknown }).phone);
        if (key) seen.add(key);
      }
      scanned += rows.length;

      if (rows.length < PAGE) break;
      if (scanned >= MAX_ROWS) {
        truncated = true;
        console.warn(`⚠️ Stopped at ${MAX_ROWS} rows — raise MAX_ROWS`);
        break;
      }
      from += PAGE;
    }

    // The buyer keys, from the live sales the caller may read: one call as the
    // caller (their row rules apply), one JSON array, no paging. If it fails
    // the keys are left out rather than the whole list refused; the app then
    // has no offline repeat check and create-sale still refuses at sync.
    let buyerKeys: string[] | undefined;
    const { data: inputs, error: inputsError } = await anonClient.rpc("buyer_key_inputs");
    if (inputsError) {
      console.error("❌ Buyer key inputs failed:", inputsError.message);
    } else {
      const keys = new Set<string>();
      for (const [phone, first, surname, joined] of (inputs ?? []) as unknown[][]) {
        const key = await buyerKey(phone, first, surname, joined);
        if (key) keys.add(key);
      }
      // Sorted, so the same sales always give the same body and the same ETag.
      buyerKeys = [...keys].sort();
    }

    // `truncated` matters to the caller: a partial set would silently let
    // duplicates through offline, so the client can choose not to trust it.
    const body = JSON.stringify({
      success: true,
      data: [...seen].sort(),
      count: seen.size,
      scanned,
      truncated,
      ...(buyerKeys ? { buyerKeys, buyerKeyRules: BUYER_KEY_RULES } : {}),
    });
    const etag = await etagOf(body);
    const headers = { ...corsHeaders, "Content-Type": "application/json", ETag: etag };
    // The gateway may hand the tag on as a weak one (W/"..."), and a client
    // sends back what it was given, so the W/ prefix is ignored, and a list
    // of tags is accepted.
    const sentBack = (req.headers.get("If-None-Match") ?? "")
      .split(",")
      .map((t) => t.trim().replace(/^W\//, ""));
    if (sentBack.includes(etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: 200, headers });
  } catch (error) {
    console.error("❌ get-end-user-phones error:", error);
    return json({ success: false, error: (error as Error).message }, 500);
  }
});

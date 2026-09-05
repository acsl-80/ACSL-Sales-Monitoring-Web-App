// The sale field dictionary, served to the phone app and anything else that
// cannot import the JSON at build time.
//
// One source: supabase/functions/_shared/sale-dictionary.json. The web app
// bundles the same file, so both apps read the same words. A signed-in user
// of either app may read it; it holds no data about anyone.
//
// GET /functions/v1/sale-dictionary
//   -> { version, source, groups, fields }
// The response never removes or renames a field or a key; it only adds.
// `ETag` carries the version so a client can ask cheaply whether it changed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SALE_DICTIONARY } from "../_shared/sale-dictionary.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "etag",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "GET") return json(405, { success: false, error: "GET only" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  if (!SUPABASE_URL || !ANON) return json(500, { success: false, error: "Server not configured" });

  // The token is read off the header and handed to getUser explicitly. A
  // client given only a global Authorization header refused every valid
  // session once in this repository; data-center-read carries the same shape.
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { success: false, error: "Missing Authorization header" });
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) return json(401, { success: false, error: "Unauthorized" });

  const etag = `"${SALE_DICTIONARY.version}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ...corsHeaders, ETag: etag, Vary: "Authorization" } });
  }
  // Revalidate every time, never serve from a cache: a browser that cached an
  // authenticated answer would otherwise hand it to a request with no token.
  // The ETag keeps a revalidation cheap (304).
  return json(200, SALE_DICTIONARY, { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Authorization" });
});

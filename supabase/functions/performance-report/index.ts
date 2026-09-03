import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * performance-report: the Performance Report screens, one request each.
 *
 * Slice 10a of the 2026-09-02 review (finding F8). The States Performance
 * Report pulled every stove and every sale into the browser a thousand rows
 * at a time, paged every user through six role loops, probed two assignment
 * tables column by column, and joined it all in JavaScript. This function
 * answers from SQL, service role only, after checking that the caller holds
 * the performance-report route.
 *
 * Actions, as a JSON body:
 *   { action: "states" }
 *       -> report_states_performance(): every state with its counts and the
 *          partner and agent lists the modals show.
 *   { action: "state-stoves", state, status?, search?, page?, limit? }
 *       -> report_state_stoves(): one page of the stoves in a state, at most
 *          500 a page, with the total.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The roles that hold the performance-report route in src/lib/permissions.ts.
const ROUTE_ROLES = new Set(["super_admin", "acsl_agent_manager", "acsl_agent", "partner"]);
const STATUSES = new Set(["all", "sold", "available"]);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function positiveInt(value: unknown, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ success: false, error: "Authorization required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    // The token is validated explicitly: a client carrying the header alone has
    // no session of its own, and getUser() without one answers "missing".
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !userData?.user) {
      console.error("performance-report: token rejected:", authError?.message);
      return json({ success: false, error: "Your session is invalid or has expired" }, 401);
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("role, status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active" || !ROUTE_ROLES.has(profile.role)) {
      return json({ success: false, error: "You do not have access to the Performance Report" }, 403);
    }

    const body: Record<string, unknown> =
      req.method === "POST"
        ? await req.json().catch(() => ({}))
        : Object.fromEntries(new URL(req.url).searchParams.entries());
    const action = String(body.action ?? "states");

    if (action === "states") {
      const { data, error } = await admin.rpc("report_states_performance");
      if (error) throw error;
      return json({ success: true, data, performance: { ms: Date.now() - started } });
    }

    if (action === "state-stoves") {
      const state = typeof body.state === "string" ? body.state.trim() : "";
      if (!state) return json({ success: false, error: "state is required" }, 400);
      const status = String(body.status ?? "all");
      if (!STATUSES.has(status)) {
        return json({ success: false, error: "status must be all, sold or available" }, 400);
      }
      const page = positiveInt(body.page, 1);
      const limit = Math.min(MAX_LIMIT, positiveInt(body.limit, DEFAULT_LIMIT));
      const search = typeof body.search === "string" ? body.search.trim() : "";

      const { data, error } = await admin.rpc("report_state_stoves", {
        p_state: state,
        p_status: status,
        p_search: search || null,
        p_page: page,
        p_limit: limit,
      });
      if (error) throw error;
      const total = Number(data?.total ?? 0);
      return json({
        success: true,
        data: data?.rows ?? [],
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        performance: { ms: Date.now() - started },
      });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("performance-report failed:", e);
    return json(
      { success: false, error: e instanceof Error ? e.message : "The report could not be computed" },
      500,
    );
  }
});

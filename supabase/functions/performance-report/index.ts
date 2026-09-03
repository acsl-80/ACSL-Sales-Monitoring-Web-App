import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * performance-report: the Performance Report screens, one request each.
 *
 * Slices 10a and 10b of the 2026-09-02 review (finding F8). The three tabs
 * did the report's work in the browser: the States tab pulled every stove and
 * every sale, the Agents tab made two requests per agent, the Partners tab one
 * per row. This function answers each from SQL, service role only, after
 * checking that the caller's role may see that part of the report.
 *
 * Actions, as a JSON body:
 *   { action: "states" }
 *       -> report_states_performance(): every state with its counts and the
 *          partner and agent lists the modals show.
 *   { action: "state-stoves", state, status?, search?, page?, limit? }
 *       -> report_state_stoves(): one page of the stoves in a state, at most
 *          500 a page, with the total.
 *   { action: "agents", agent_ids }
 *       -> report_agents_performance(): per agent, received, sold, available,
 *          direct partners and states, with the totals across them.
 *   { action: "partner-agents", organization_ids }
 *       -> report_partner_agents(): the agents covering each partner, with
 *          what each sold there, keyed by organisation id. A manager sees
 *          their own agents; an agent sees only partners in their scope; a
 *          partner sees none, as the agents function already answers them.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Who may ask for what. The states actions follow the performance-report
// route in src/lib/permissions.ts; the agents actions follow the read gates of
// the super-admin-agents function they replace.
const ROUTE_ROLES = ["super_admin", "acsl_agent_manager", "acsl_agent", "partner"];
const ACTION_ROLES: Record<string, Set<string>> = {
  states: new Set(ROUTE_ROLES),
  "state-stoves": new Set(ROUTE_ROLES),
  agents: new Set(["super_admin", "acsl_agent_manager"]),
  "partner-agents": new Set(["super_admin", "acsl_agent_manager", "acsl_agent", "super_admin_agent", "partner"]),
};
const STATUSES = new Set(["all", "sold", "available"]);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;
const MAX_IDS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** A list of ids from the body: distinct, well formed, capped. */
function idList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const ids = raw.map((v) => String(v).trim()).filter((v) => UUID.test(v));
  return [...new Set(ids)].slice(0, MAX_IDS);
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
    const userId = userData.user.id;

    const { data: profile } = await admin
      .from("profiles")
      .select("role, status")
      .eq("id", userId)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json({ success: false, error: "You do not have access to the Performance Report" }, 403);
    }

    const body: Record<string, unknown> =
      req.method === "POST"
        ? await req.json().catch(() => ({}))
        : Object.fromEntries(new URL(req.url).searchParams.entries());
    const action = String(body.action ?? "states");
    const allowed = ACTION_ROLES[action];
    if (!allowed) return json({ success: false, error: `Unknown action: ${action}` }, 400);
    if (!allowed.has(profile.role)) {
      return json({ success: false, error: "You do not have access to this part of the Performance Report" }, 403);
    }
    const performance = () => ({ ms: Date.now() - started });

    if (action === "states") {
      const { data, error } = await admin.rpc("report_states_performance");
      if (error) throw error;
      return json({ success: true, data, performance: performance() });
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
        performance: performance(),
      });
    }

    if (action === "agents") {
      const agentIds = idList(body.agent_ids);
      if (agentIds.length === 0) {
        return json({
          success: true,
          data: { agents: [], totals: { assigned: 0, sold: 0, unsold: 0 } },
          performance: performance(),
        });
      }
      const { data, error } = await admin.rpc("report_agents_performance", { p_agent_ids: agentIds });
      if (error) throw error;
      return json({ success: true, data, performance: performance() });
    }

    if (action === "partner-agents") {
      let orgIds = idList(body.organization_ids);
      if (orgIds.length === 0 || profile.role === "partner") {
        return json({ success: true, data: {}, performance: performance() });
      }
      // An agent sees only the partners in their own scope.
      if (profile.role === "acsl_agent" || profile.role === "super_admin_agent") {
        const { data: scope, error: scopeError } = await admin.rpc("acsl_agent_org_scope", {
          p_agent_ids: [userId],
        });
        if (scopeError) throw scopeError;
        const mine = new Set((scope ?? []).map((r: { organization_id: string }) => r.organization_id));
        orgIds = orgIds.filter((id) => mine.has(id));
      }
      const { data, error } = await admin.rpc("report_partner_agents", {
        p_org_ids: orgIds,
        p_manager_id: profile.role === "acsl_agent_manager" ? userId : null,
      });
      if (error) throw error;
      return json({ success: true, data: data ?? {}, performance: performance() });
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

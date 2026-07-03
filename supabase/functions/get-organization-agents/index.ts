// get-organization-agents
// Returns the agents tied to a given organization (partner), for the
// "sold on behalf of" picker in the create-sale flow.
//
//  - super_admin:        every acsl_agent / acsl_agent_manager / partner_agent
//                        tied to the org.
//  - acsl_agent_manager: only agents under them (profiles.manager_id = caller)
//                        tied to the org, plus themselves.
//  - anyone else:        403 (they sell only as themselves).
//
// "Tied to the org" = profiles.organization_id = org  OR  a row in
// acsl_agent_organizations(agent_id, organization_id).
//
// Request:  GET  /get-organization-agents?organization_id=<uuid>
//           (also accepts { organization_id } in a POST body)
// Response: { success, data: [{ id, full_name, email, phone, role, status, manager_id }] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SELLABLE_ROLES = ["acsl_agent", "acsl_agent_manager", "partner_agent"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, message: "Authorization required" }, 401);

    // Service-role client (bypass RLS) + user client (identify caller).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData?.user) {
      return json({ success: false, message: "Invalid authentication" }, 401);
    }
    const callerId = userData.user.id;

    const { data: caller, error: callerErr } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", callerId)
      .single();
    if (callerErr || !caller) {
      return json({ success: false, message: "Profile lookup failed" }, 500);
    }

    const isSuperAdmin = caller.role === "super_admin";
    const isManager = caller.role === "acsl_agent_manager";
    if (!isSuperAdmin && !isManager) {
      return json({ success: false, message: "Not permitted to sell on behalf of others" }, 403);
    }

    // organization_id from query string or body.
    const url = new URL(req.url);
    let organizationId = url.searchParams.get("organization_id");
    if (!organizationId && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      organizationId = body?.organization_id ?? null;
    }
    if (!organizationId) {
      return json({ success: false, message: "organization_id is required" }, 400);
    }

    // Agent ids explicitly assigned to the org.
    const { data: assignRows } = await admin
      .from("acsl_agent_organizations")
      .select("agent_id")
      .eq("organization_id", organizationId);
    const assignedIds = (assignRows ?? []).map((r: { agent_id: string }) => r.agent_id);

    // Build: profiles in sellable roles where org matches directly OR assigned.
    // Two queries unioned in JS (Supabase .or with a sub-list of ids).
    const seen = new Set<string>();
    const results: Record<string, unknown>[] = [];

    const pushRows = (rows: Record<string, unknown>[] | null) => {
      for (const r of rows ?? []) {
        const id = r.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          results.push(r);
        }
      }
    };

    const baseSelect = "id, full_name, email, phone, role, status, manager_id";

    // direct org members
    const { data: directRows } = await admin
      .from("profiles")
      .select(baseSelect)
      .eq("organization_id", organizationId)
      .in("role", SELLABLE_ROLES);
    pushRows(directRows);

    // assigned-via-join members
    if (assignedIds.length > 0) {
      const { data: assignedRows } = await admin
        .from("profiles")
        .select(baseSelect)
        .in("id", assignedIds)
        .in("role", SELLABLE_ROLES);
      pushRows(assignedRows);
    }

    // Manager scope: only their own team (+ themselves).
    let data = results;
    if (isManager && !isSuperAdmin) {
      data = results.filter(
        (r) => r.manager_id === callerId || r.id === callerId
      );
    }

    return json({ success: true, data });
  } catch (e) {
    return json({ success: false, message: `Unexpected error: ${e}` }, 500);
  }
});

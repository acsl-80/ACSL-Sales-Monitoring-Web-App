import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

function jsonError(message: string, status: number): Response {
  return withCors(new Response(JSON.stringify({ success: false, message }), { status, headers: { "Content-Type": "application/json" } }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));
  if (req.method !== "GET") return jsonError("Method not allowed", 405);

  // JWT auth — only super_admin or admin can access logs
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("Missing authorization header", 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Verify the caller's JWT — pass the raw token to getUser()
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonError("Invalid or expired token", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["super_admin", "admin"].includes(profile.role)) {
    return jsonError("Access denied. Admin role required.", 403);
  }

  // Parse query params
  const url = new URL(req.url);
  const id = url.searchParams.get("id"); // fetch single log by ID
  const source = url.searchParams.get("source"); // "external-sync" | "external-csv-sync" | null (all)
  const status = url.searchParams.get("status");   // "success" | "partial" | "failed" | null
  const application_name = url.searchParams.get("application_name");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const date_from = url.searchParams.get("date_from");
  const date_to = url.searchParams.get("date_to");
  const include_entries = url.searchParams.get("include_entries") === "true" || !!id; // always include entries for single fetch

  // Build query — omit entries by default for the list view (they can be large)
  let query = supabase
    .from("sync_logs")
    .select(include_entries
      ? "*"
      : "id, source, status, application_name, started_at, completed_at, duration_ms, total_partners, partners_created, partners_updated, partners_failed, total_stove_ids, stove_ids_created, stove_ids_skipped, request_summary, error_message, created_at"
    )
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (id) query = query.eq("id", id);
  if (source) query = query.eq("source", source);
  if (status) query = query.eq("status", status);
  if (application_name) query = query.ilike("application_name", `%${application_name}%`);
  if (date_from) query = query.gte("started_at", date_from);
  if (date_to) query = query.lte("started_at", date_to);

  const { data: logs, error: fetchError, count } = await (query as any);

  if (fetchError) {
    return jsonError(`Failed to fetch logs: ${fetchError.message}`, 500);
  }

  // Count query for pagination
  let countQuery = supabase.from("sync_logs").select("id", { count: "exact", head: true });
  if (source) countQuery = countQuery.eq("source", source);
  if (status) countQuery = countQuery.eq("status", status);
  if (application_name) countQuery = countQuery.ilike("application_name", `%${application_name}%`);
  if (date_from) countQuery = countQuery.gte("started_at", date_from);
  if (date_to) countQuery = countQuery.lte("started_at", date_to);

  const { count: totalCount } = await countQuery;

  return withCors(
    new Response(
      JSON.stringify({
        success: true,
        data: logs,
        pagination: {
          total: totalCount ?? 0,
          limit,
          offset,
          has_more: offset + limit < (totalCount ?? 0),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

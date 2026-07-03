import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

const ACSL_SCOPED_ROLES = ["acsl_agent", "acsl_agent_manager", "super_admin_agent"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authorization token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user role and organization from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_id")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      (profile.role !== "super_admin" &&
        profile.role !== "admin" &&
        profile.role !== "partner" &&
        !ACSL_SCOPED_ROLES.includes(profile.role))
    ) {
      throw new Error("Insufficient permissions");
    }

    const isAcslScoped = ACSL_SCOPED_ROLES.includes(profile.role);

    // Get query parameters
    const url = new URL(req.url);
    let organizationIds =
      url.searchParams.get("organization_ids")?.split(",").filter(Boolean) || [];

    const dateFrom    = url.searchParams.get("dateFrom") || "";
    const dateTo      = url.searchParams.get("dateTo") || "";
    const partnerType = url.searchParams.get("partner_type") || "";
    const search      = url.searchParams.get("search") || "";
    const stateFilter = url.searchParams.get("state") || "";

    // For admin users, force filter to their organization only
    if (profile.role === "admin" && profile.organization_id) {
      organizationIds = [profile.organization_id];
    }

    // For partner users, force filter to their organization only
    if (profile.role === "partner" && profile.organization_id) {
      organizationIds = [profile.organization_id];
    }

    // ACSL agents/managers: scope to assigned orgs (intersect with any requested subset)
    if (isAcslScoped) {
      const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, user.id);
      organizationIds = organizationIds.length > 0
        ? organizationIds.filter((id: string) => assignedOrgIds.includes(id))
        : assignedOrgIds;
      if (organizationIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, data: { available: 0, sold: 0, total: 0, performing_partners: 0 } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
    }

    // Resolve org IDs for total/available/sold stats (includes registration date filter)
    const hasOrgFilters = dateFrom || dateTo || partnerType || search || stateFilter;
    if (hasOrgFilters && (profile.role === "super_admin" || isAcslScoped)) {
      let orgQuery = supabase.from("organizations").select("id");
      if (dateFrom) orgQuery = orgQuery.gte("created_at", dateFrom);
      if (dateTo)   orgQuery = orgQuery.lte("created_at", dateTo + "T23:59:59");
      if (partnerType) orgQuery = orgQuery.ilike("partner_type", partnerType);
      if (stateFilter) orgQuery = orgQuery.ilike("state", stateFilter);
      if (search) orgQuery = orgQuery.or(`partner_name.ilike.%${search}%,partner_id.ilike.%${search}%`);
      const { data: filteredOrgs } = await orgQuery;
      const filteredIds = (filteredOrgs || []).map((o: any) => o.id);
      organizationIds = organizationIds.length > 0
        ? filteredIds.filter((id: string) => organizationIds.includes(id))
        : filteredIds;
    }

    // Resolve org IDs for performing_partners — uses sale_date for time window,
    // so only apply non-date org filters here (partner_type, search, state)
    let performingOrgIds: string[] = [];
    if (profile.role === "super_admin") {
      const hasNonDateOrgFilters = partnerType || search || stateFilter;
      if (hasNonDateOrgFilters) {
        let nonDateQuery = supabase.from("organizations").select("id");
        if (partnerType) nonDateQuery = nonDateQuery.ilike("partner_type", partnerType);
        if (stateFilter) nonDateQuery = nonDateQuery.ilike("state", stateFilter);
        if (search) nonDateQuery = nonDateQuery.or(`partner_name.ilike.%${search}%,partner_id.ilike.%${search}%`);
        const { data: nonDateOrgs } = await nonDateQuery;
        performingOrgIds = (nonDateOrgs || []).map((o: any) => o.id);
      }
    } else {
      // admin/partner: already scoped to their own org
      performingOrgIds = organizationIds;
    }

    // Get stove ID statistics using count for better performance and no row limit
    let totalQuery = supabase
      .from("stove_ids")
      .select("*", { count: "exact", head: true })
      .eq("is_archived", false);

    let availableQuery = supabase
      .from("stove_ids")
      .select("*", { count: "exact", head: true })
      .eq("status", "available")
      .eq("is_archived", false);

    let soldQuery = supabase
      .from("stove_ids")
      .select("*", { count: "exact", head: true })
      .eq("status", "sold")
      .eq("is_archived", false);

    // Top performing window: use provided date range or default to last 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
    const performingFrom = dateFrom || thirtyDaysAgo;
    const performingTo   = dateTo   || now.toISOString().split("T")[0];

    // Query sales table for distinct org IDs with at least 1 sale in the window
    // sales.sales_date is the authoritative sale date field
    let performingOrgsQuery = supabase
      .from("sales")
      .select("organization_id")
      .eq("is_archived", false)
      .gte("sales_date", performingFrom)
      .lte("sales_date", performingTo);

    // Filter total/available/sold by resolved org IDs (includes registration date filter)
    if (organizationIds.length > 0) {
      totalQuery     = totalQuery.in("organization_id", organizationIds);
      availableQuery = availableQuery.in("organization_id", organizationIds);
      soldQuery      = soldQuery.in("organization_id", organizationIds);
    } else if (hasOrgFilters || isAcslScoped) {
      // Filters were active (or the caller is org-scoped) but no orgs matched — return zeros
      return new Response(
        JSON.stringify({ success: true, data: { available: 0, sold: 0, total: 0, performing_partners: 0 } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Filter performing_partners by non-date org IDs only (sale_date handles the time window)
    if (performingOrgIds.length > 0) {
      performingOrgsQuery = performingOrgsQuery.in("organization_id", performingOrgIds);
    }

    // Execute all queries in parallel
    const [totalResult, availableResult, soldResult, performingOrgsResult] = await Promise.all([
      totalQuery,
      availableQuery,
      soldQuery,
      performingOrgsQuery,
    ]);

    if (totalResult.error) throw totalResult.error;
    if (availableResult.error) throw availableResult.error;
    if (soldResult.error) throw soldResult.error;

    // Get counts from results
    const total = totalResult.count || 0;
    const available = availableResult.count || 0;
    const sold = soldResult.count || 0;

    // Count distinct orgs with at least 1 sale in the window
    const performingOrgsSet = new Set(
      (performingOrgsResult.data || []).map((r: any) => r.organization_id)
    );
    const performing_partners = performingOrgsSet.size;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          available,
          sold,
          total,
          performing_partners,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.message === "Unauthorized" ? 401 : 500,
      },
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Grouping lives in public.organizations_grouped (migration 20260903050000):
// by EXACT partner_name after case and whitespace are normalised, and by
// nothing else. It stays deliberately un-fuzzy: a parenthetical suffix, a
// payment-model tag or a spelling difference IS a different partner record
// with its own stock. The history of why is in that migration's header.

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

    // Get user role from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "super_admin") {
      throw new Error("Insufficient permissions");
    }

    // Get query parameters
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = parseInt(url.searchParams.get("page_size") || "30");

    /*
     * Grouped, sorted and paged in SQL. The rows used to be fetched whole and
     * grouped here, and an unranged select stops at 1,000 rows, so past a
     * thousand organisations the list and its count went quietly short.
     */
    const { data: grouped, error } = await supabase.rpc("organizations_grouped", {
      p_search: search || null,
      p_page: page,
      p_page_size: pageSize,
    });

    if (error) {
      throw error;
    }

    const paginatedGroups = grouped?.data ?? [];
    const totalGroups = Number(grouped?.total_count) || 0;
    const totalPages = Math.ceil(totalGroups / pageSize);

    return new Response(
      JSON.stringify({
        success: true,
        data: paginatedGroups,
        pagination: {
          page,
          page_size: pageSize,
          total_count: totalGroups,
          total_pages: totalPages,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
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
      }
    );
  }
});

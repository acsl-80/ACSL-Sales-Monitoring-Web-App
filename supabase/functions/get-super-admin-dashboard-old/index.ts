import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      },
    );

    // Get user from token
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      throw new Error("Invalid or expired token");
    }

    // Get user role
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("Profile error:", profileError);
      throw new Error("Failed to fetch user profile");
    }

    // Check if user is super admin
    if (profile.role !== "super_admin") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized: Super admin access required",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Parse request body for filters
    const { date_from, date_to, organization_ids, customer_state } = await req
      .json()
      .catch(() => ({}));

    // Build query for stove statistics
    let stoveQuery = supabaseClient.from("stove_ids").select(
      `
        id,
        status,
        organization_id,
        created_at,
        organizations (
          id,
          partner_name,
          state
        )
      `,
      { count: "exact" },
    );

    // Apply organization filter if provided
    if (organization_ids && organization_ids.length > 0) {
      stoveQuery = stoveQuery.in("organization_id", organization_ids);
    }

    // Apply date filter if provided (using created_at)
    if (date_from || date_to) {
      if (date_from && date_to) {
        stoveQuery = stoveQuery
          .gte("created_at", date_from)
          .lte("created_at", date_to);
      } else if (date_from) {
        stoveQuery = stoveQuery.gte("created_at", date_from);
      } else if (date_to) {
        stoveQuery = stoveQuery.lte("created_at", date_to);
      }
    }

    // Apply customer state filter if provided
    if (customer_state && customer_state.trim() !== "") {
      // For state filter, we need to use inner join
      stoveQuery = supabaseClient.from("stove_ids").select(
        `
          id,
          status,
          organization_id,
          created_at,
          organizations!inner (
            id,
            partner_name,
            state
          )
        `,
        { count: "exact" },
      );
      
      // Re-apply filters
      if (organization_ids && organization_ids.length > 0) {
        stoveQuery = stoveQuery.in("organization_id", organization_ids);
      }
      
      if (date_from || date_to) {
        if (date_from && date_to) {
          stoveQuery = stoveQuery
            .gte("created_at", date_from)
            .lte("created_at", date_to);
        } else if (date_from) {
          stoveQuery = stoveQuery.gte("created_at", date_from);
        } else if (date_to) {
          stoveQuery = stoveQuery.lte("created_at", date_to);
        }
      }

      stoveQuery = stoveQuery.eq("organizations.state", customer_state.trim());
    }

    const { data: stoveData, error: stoveError } = await stoveQuery;

    if (stoveError) {
      console.error("Stove query error:", stoveError);
      throw new Error("Failed to fetch stove statistics");
    }

    // Calculate statistics from stove data
    const stovesSoldToPartners = stoveData.filter(
      (s) => s.status === "received",
    ).length;
    const stovesSoldToEndUsers = stoveData.filter(
      (s) => s.status === "sold",
    ).length;
    const availableStovesWithPartners = stoveData.filter(
      (s) => s.status === "available",
    ).length;

    // Get unique organizations (partners)
    const uniqueOrganizations = new Set(
      stoveData.map((s) => s.organization_id),
    );
    const totalPartners = uniqueOrganizations.size;

    // Get total customers (unique sold_to values with sale_date applied)
    let customerQuery = supabaseClient
      .from("sales")
      .select("end_user_name", { count: "exact" });

    // Apply organization filter for customers
    if (organization_ids && organization_ids.length > 0) {
      customerQuery = customerQuery.in("organization_id", organization_ids);
    }

    // Apply date filter for customers
    if (date_from || date_to) {
      if (date_from && date_to) {
        customerQuery = customerQuery
          .gte("sales_date", date_from)
          .lte("sales_date", date_to);
      } else if (date_from) {
        customerQuery = customerQuery.gte("sales_date", date_from);
      } else if (date_to) {
        customerQuery = customerQuery.lte("sales_date", date_to);
      }
    }

    // Apply customer state filter
    if (customer_state && customer_state.trim() !== "") {
      customerQuery = customerQuery.eq("state_backup", customer_state.trim());
    }

    const { count: totalCustomers, error: customerError } = await customerQuery;

    if (customerError) {
      console.error("Customer query error:", customerError);
      throw new Error("Failed to fetch customer count");
    }

    // Get list of states for the filter dropdown (from organizations)
    const { data: statesData, error: statesError } = await supabaseClient
      .from("organizations")
      .select("state")
      .order("state");

    const uniqueStates = statesData
      ? [...new Set(statesData.map((s) => s.state))].filter(Boolean).sort()
      : [];

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          stovesSoldToPartners,
          stovesSoldToEndUsers,
          availableStovesWithPartners,
          totalPartners,
          totalCustomers: totalCustomers || 0,
          states: uniqueStates,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in get-super-admin-dashboard:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

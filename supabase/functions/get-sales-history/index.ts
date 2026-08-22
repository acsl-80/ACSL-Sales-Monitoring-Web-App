import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
function withCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", {
      status: 200
    }));
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") ?? ""
      }
    }
  });
  try {
    // Authentication
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      return withCors(new Response(JSON.stringify({
        success: false,
        message: "Unauthorized"
      }), {
        status: 401
      }));
    }
    const { sale_id, action_type, page = 1, limit = 20, date_from, date_to } = await req.json();
    // Get user's organization
    const { data: profile } = await supabase.from("profiles").select("organization_id, role").eq("id", userData.user.id).single();
    if (!profile) {
      return withCors(new Response(JSON.stringify({
        success: false,
        message: "Profile not found"
      }), {
        status: 404
      }));
    }
    // Build query
    let query = supabase.from("sales_history").select(`
        id,
        sale_id,
        action_type,
        action_description,
        field_changes,
        performed_by,
        performed_at,
        sales!inner(
          id,
          transaction_id,
          stove_serial_no,
          contact_person,
          end_user_name,
          amount,
          status,
          organization_id
        )
      `).eq("sales.organization_id", profile.organization_id).order("performed_at", {
      ascending: false
    });
    // Apply filters
    if (sale_id) {
      query = query.eq("sale_id", sale_id);
    }
    if (action_type) {
      query = query.eq("action_type", action_type);
    }
    if (date_from) {
      query = query.gte("performed_at", date_from);
    }
    if (date_to) {
      query = query.lte("performed_at", date_to);
    }
    // If user is an agent, only show their own history
    if (profile.role === "agent") {
      query = query.eq("performed_by", userData.user.id);
    }
    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    const { data: historyData, error: historyError } = await query;
    if (historyError) {
      console.error("Error fetching history:", historyError);
      return withCors(new Response(JSON.stringify({
        success: false,
        message: "Failed to fetch sales history"
      }), {
        status: 500
      }));
    }
    // Get performer profiles for the history records
    let enrichedHistoryData = historyData;
    if (historyData && historyData.length > 0) {
      const performerIds = [
        ...new Set(historyData.map((h)=>h.performed_by))
      ];
      const { data: performerProfiles, error: profileError } = await supabase.from("profiles").select("id, full_name, email, role").in("id", performerIds);
      if (profileError) {
        console.warn("Error fetching performer profiles:", profileError);
      }
      // Merge performer data with history records
      enrichedHistoryData = historyData.map((historyItem)=>({
          ...historyItem,
          performer: performerProfiles?.find((p)=>p.id === historyItem.performed_by) || null
        }));
    }
    // Get total count for pagination
    let countQuery = supabase.from("sales_history").select("*, sales!inner(organization_id)", {
      count: "exact",
      head: true
    }).eq("sales.organization_id", profile.organization_id);
    if (sale_id) {
      countQuery = countQuery.eq("sale_id", sale_id);
    }
    if (action_type) {
      countQuery = countQuery.eq("action_type", action_type);
    }
    if (date_from) {
      countQuery = countQuery.gte("performed_at", date_from);
    }
    if (date_to) {
      countQuery = countQuery.lte("performed_at", date_to);
    }
    if (profile.role === "agent") {
      countQuery = countQuery.eq("performed_by", userData.user.id);
    }
    const { count, error: countError } = await countQuery;
    if (countError) {
      console.error("Error counting history:", countError);
    }
    // Get summary stats
    let statsQuery = supabase.from("sales_history").select("action_type, sales!inner(organization_id)").eq("sales.organization_id", profile.organization_id);
    if (profile.role === "agent") {
      statsQuery = statsQuery.eq("performed_by", userData.user.id);
    }
    const { data: statsData } = await statsQuery;
    const stats = {
      total: count || 0,
      created: statsData?.filter((h)=>h.action_type === "created").length || 0,
      updated: statsData?.filter((h)=>h.action_type === "updated").length || 0,
      completed: statsData?.filter((h)=>h.action_type === "completed").length || 0
    };
    return withCors(new Response(JSON.stringify({
      success: true,
      data: enrichedHistoryData,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      },
      stats
    }), {
      status: 200
    }));
  } catch (error) {
    console.error("Error in get-sales-history:", error);
    return withCors(new Response(JSON.stringify({
      success: false,
      message: "An unexpected error occurred"
    }), {
      status: 500
    }));
  }
});

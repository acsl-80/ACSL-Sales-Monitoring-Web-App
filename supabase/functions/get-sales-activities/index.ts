import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

function withCors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res;
}

interface GetActivitiesRequest {
  user_id?: string;
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
  action_type?: string;
}

interface ActivitySummary {
  date: string;
  total_activities: number;
  created_count: number;
  updated_count: number;
  completed_count: number;
  assigned_count: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    }
  );

  try {
    // Authentication
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      return withCors(
        new Response(
          JSON.stringify({ success: false, message: "Unauthorized" }),
          { status: 401 }
        )
      );
    }

    const {
      user_id,
      page = 1,
      limit = 20,
      date_from,
      date_to,
      action_type,
    }: GetActivitiesRequest = await req.json();

    // Get user's organization and role
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, role")
      .eq("id", userData.user.id)
      .single();

    if (!profile) {
      return withCors(
        new Response(
          JSON.stringify({ success: false, message: "Profile not found" }),
          { status: 404 }
        )
      );
    }

    // Build base query with enhanced data
    let query = supabase
      .from("sales_history")
      .select(
        `
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
          organization_id,
          partner_name,
          contact_phone
        ),
        profiles!sales_history_performed_by_fkey(
          id,
          full_name,
          email,
          role,
          organization:organizations(
            id,
            name
          )
        )
      `
      )
      .eq("sales.organization_id", profile.organization_id)
      .order("performed_at", { ascending: false });

    // Apply user-based filtering
    if (user_id) {
      query = query.eq("performed_by", user_id);
    } else if (profile.role === "agent") {
      // Agents can only see their own activities
      query = query.eq("performed_by", userData.user.id);
    }

    // Apply filters
    if (action_type) {
      query = query.eq("action_type", action_type);
    }

    if (date_from) {
      query = query.gte("performed_at", date_from);
    }

    if (date_to) {
      query = query.lte("performed_at", date_to);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: activitiesData, error: activitiesError } = await query;

    if (activitiesError) {
      console.error("Error fetching activities:", activitiesError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Failed to fetch sales activities",
          }),
          { status: 500 }
        )
      );
    }

    // Get total count for pagination
    let countQuery = supabase
      .from("sales_history")
      .select("*", { count: "exact", head: true })
      .eq("sales.organization_id", profile.organization_id);

    if (user_id) {
      countQuery = countQuery.eq("performed_by", user_id);
    } else if (profile.role === "agent") {
      countQuery = countQuery.eq("performed_by", userData.user.id);
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

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error("Error counting activities:", countError);
    }

    // Get activity summary for the date range
    let summaryQuery = supabase
      .from("sales_history")
      .select(
        `
        performed_at,
        action_type
      `
      )
      .eq("sales.organization_id", profile.organization_id);

    if (user_id) {
      summaryQuery = summaryQuery.eq("performed_by", user_id);
    } else if (profile.role === "agent") {
      summaryQuery = summaryQuery.eq("performed_by", userData.user.id);
    }

    if (date_from) {
      summaryQuery = summaryQuery.gte("performed_at", date_from);
    }

    if (date_to) {
      summaryQuery = summaryQuery.lte("performed_at", date_to);
    }

    const { data: summaryData } = await summaryQuery;

    // Calculate daily activity summary
    const dailySummary: ActivitySummary[] = [];
    if (summaryData) {
      const groupedByDate = summaryData.reduce((acc, activity) => {
        const date = new Date(activity.performed_at)
          .toISOString()
          .split("T")[0];
        if (!acc[date]) {
          acc[date] = {
            date,
            total_activities: 0,
            created_count: 0,
            updated_count: 0,
            completed_count: 0,
            assigned_count: 0,
          };
        }
        acc[date].total_activities++;
        if (activity.action_type === "created") acc[date].created_count++;
        if (activity.action_type === "updated") acc[date].updated_count++;
        if (activity.action_type === "completed") acc[date].completed_count++;
        if (activity.action_type === "assigned") acc[date].assigned_count++;
        return acc;
      }, {} as Record<string, ActivitySummary>);

      dailySummary.push(
        ...Object.values(groupedByDate)
          .sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )
          .slice(0, 7)
      ); // Last 7 days
    }

    // Get overall stats
    const stats = {
      total: count || 0,
      created:
        summaryData?.filter((h) => h.action_type === "created").length || 0,
      updated:
        summaryData?.filter((h) => h.action_type === "updated").length || 0,
      completed:
        summaryData?.filter((h) => h.action_type === "completed").length || 0,
      assigned:
        summaryData?.filter((h) => h.action_type === "assigned").length || 0,
    };

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            activities: activitiesData,
            daily_summary: dailySummary,
            stats,
            pagination: {
              page,
              limit,
              total: count || 0,
              totalPages: Math.ceil((count || 0) / limit),
            },
          },
        }),
        { status: 200 }
      )
    );
  } catch (error) {
    console.error("Error in get-sales-activities:", error);
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: "An unexpected error occurred",
        }),
        { status: 500 }
      )
    );
  }
});

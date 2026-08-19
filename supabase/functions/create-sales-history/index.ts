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

interface CreateHistoryRequest {
  sale_id: string;
  action_type: string;
  action_description: string;
  field_changes?: Record<string, any>;
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
      sale_id,
      action_type,
      action_description,
      field_changes = {},
    }: CreateHistoryRequest = await req.json();

    // Validate required fields
    if (!sale_id || !action_type || !action_description) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message:
              "Missing required fields: sale_id, action_type, action_description",
          }),
          { status: 400 }
        )
      );
    }

    // Verify the sale exists and user has access to it
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("id, organization_id")
      .eq("id", sale_id)
      .single();

    if (saleError || !sale) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Sale not found or access denied",
          }),
          { status: 404 }
        )
      );
    }

    // Get user's organization to verify access
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userData.user.id)
      .single();

    if (!profile || profile.organization_id !== sale.organization_id) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Access denied to this sale",
          }),
          { status: 403 }
        )
      );
    }

    // Use the custom function to add history
    const { data: historyData, error: historyError } = await supabase.rpc(
      "add_custom_sales_history",
      {
        p_sale_id: sale_id,
        p_action_type: action_type,
        p_action_description: action_description,
        p_field_changes: field_changes,
      }
    );

    if (historyError) {
      console.error("Error creating history:", historyError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Failed to create history record",
          }),
          { status: 500 }
        )
      );
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          message: "History record created successfully",
          data: { history_id: historyData },
        }),
        { status: 201 }
      )
    );
  } catch (error) {
    console.error("Error in create-sales-history:", error);
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

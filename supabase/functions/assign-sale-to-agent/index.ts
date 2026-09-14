// Function to assign sales to agents (Admin only)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

function withCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers", 
    "Content-Type, Authorization"
  );
  return res;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(
      new Response("ok", {
        status: 200,
      })
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization"),
        },
      },
    }
  );

  try {
    const body = await req.json();
    const { saleId, agentId } = body;

    if (!saleId || !agentId) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "saleId and agentId are required",
          }),
          {
            status: 400,
          }
        )
      );
    }

    // Authenticate user
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Unauthorized",
          }),
          {
            status: 401,
          }
        )
      );
    }

    const userId = userData.user.id;

    // Check if user is admin
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, organization_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile || profile.role !== 'admin') {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Admin access required",
          }),
          {
            status: 403,
          }
        )
      );
    }

    // Verify agent belongs to same organization
    const { data: agent, error: agentError } = await supabase
      .from("profiles")
      .select("id, organization_id, role")
      .eq("id", agentId)
      .eq("organization_id", profile.organization_id)
      .eq("role", "agent")
      .maybeSingle();

    if (agentError || !agent) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Agent not found in your organization",
          }),
          {
            status: 404,
          }
        )
      );
    }

    // Update sale with assignment and set status to 'assigned'
    const { error: updateError } = await supabase
      .from("sales")
      .update({
        created_by: agentId, // Assign to agent
        status: 'assigned',   // Manual status override
      })
      .eq("id", saleId)
      .eq("organization_id", profile.organization_id);

    if (updateError) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Failed to assign sale",
            error: updateError,
          }),
          {
            status: 500,
          }
        )
      );
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          message: "Sale assigned successfully",
          saleId,
          agentId,
        }),
        {
          status: 200,
        }
      )
    );
  } catch (error) {
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: "Internal server error",
          error: error.message,
        }),
        {
          status: 500,
        }
      )
    );
  }
});

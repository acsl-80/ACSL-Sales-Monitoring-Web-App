import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      recipient_email,
      recipient_name,
      subject,
      html_content,
      message,
      link,
      notification_key,
      is_automatic = false,
    } = await req.json();

    if (!recipient_email || !subject || (!message && !html_content)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: recipient_email, subject, message or html_content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read email config from DB
    const { data: config, error: configError } = await adminClient
      .from("email_config")
      .select("*")
      .limit(1)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: "Email config not found. Please configure email settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!config.is_configured || !config.resend_api_key) {
      return new Response(
        JSON.stringify({ error: "Email not configured. Please add your Resend API key in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromAddress = config.sender_name
      ? `${config.sender_name} <${config.sender_email}>`
      : config.sender_email;

    // Build HTML if not provided
    const htmlBody = html_content ?? `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f0f7ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 24px; margin-bottom: 16px;">
          <h2 style="margin: 0 0 12px; color: #07376a; font-size: 18px;">${subject}</h2>
          <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${message}</p>
        </div>
        ${link ? `<div style="text-align: center; margin-top: 16px;">
          <a href="${link}" style="display: inline-block; background-color: #07376a; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">View Details</a>
        </div>` : ""}
        <p style="margin-top: 24px; color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated notification from ${config.sender_name || "Atmosfair Sales"}.
        </p>
      </div>
    `;

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resend_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [recipient_email],
        subject,
        html: htmlBody,
      }),
    });

    const resendData = await resendRes.json();

    // Log the attempt
    await adminClient.from("email_logs").insert({
      recipient_email,
      recipient_name: recipient_name || null,
      subject,
      notification_key: notification_key || null,
      status: resendRes.ok ? "sent" : "failed",
      error_message: resendRes.ok ? null : JSON.stringify(resendData),
      is_automatic,
      resend_id: resendRes.ok ? resendData.id : null,
    });

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: resendData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

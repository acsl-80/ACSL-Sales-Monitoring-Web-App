/**
 * Shared email utility — sends via Resend using config stored in email_config table.
 * Logs every attempt to email_logs.
 * Never throws — always returns success/failure gracefully.
 */
export async function sendEmail(
  supabase: any,
  opts: {
    to: string;
    toName?: string;
    subject: string;
    htmlContent: string;
    notificationKey?: string;
    isAutomatic?: boolean;
  }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: config } = await supabase
      .from("email_config")
      .select("resend_api_key, sender_name, sender_email, is_configured")
      .limit(1)
      .single();

    if (!config?.is_configured || !config?.resend_api_key) {
      console.warn("⚠️ Email not configured — skipping send");
      return { ok: false, error: "Email not configured" };
    }

    const fromAddress = config.sender_name
      ? `${config.sender_name} <${config.sender_email}>`
      : config.sender_email;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resend_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [opts.to],
        subject: opts.subject,
        html: opts.htmlContent,
      }),
    });

    const data = await res.json();

    // Log
    await supabase.from("email_logs").insert({
      recipient_email: opts.to,
      recipient_name: opts.toName ?? null,
      subject: opts.subject,
      notification_key: opts.notificationKey ?? null,
      status: res.ok ? "sent" : "failed",
      error_message: res.ok ? null : JSON.stringify(data),
      is_automatic: opts.isAutomatic ?? true,
      resend_id: res.ok ? data.id : null,
    });

    if (!res.ok) {
      console.warn(`⚠️ Resend failed (${res.status}):`, data);
      return { ok: false, error: JSON.stringify(data) };
    }

    console.log("✅ Email sent to:", opts.to);
    return { ok: true };
  } catch (err) {
    console.warn("⚠️ sendEmail error:", err);
    return { ok: false, error: String(err) };
  }
}

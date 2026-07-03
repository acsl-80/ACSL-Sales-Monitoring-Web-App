
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/useAuth";

export interface EmailConfig {
  id: string;
  resend_api_key: string;
  sender_name: string;
  sender_email: string;
  is_configured: boolean;
}

export function useEmailConfig() {
  const { supabase } = useAuth();
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("email_config")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!error && data) setConfig(data as EmailConfig);
    setLoading(false);
  };

  useEffect(() => { fetchConfig(); }, []);

  const saveConfig = async (values: {
    resend_api_key: string;
    sender_name: string;
    sender_email: string;
  }) => {
    setSaving(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const isConfigured = !!values.resend_api_key && !!values.sender_email;

      if (config?.id) {
        const { error } = await supabase
          .from("email_config")
          .update({
            resend_api_key: values.resend_api_key,
            sender_name: values.sender_name,
            sender_email: values.sender_email,
            is_configured: isConfigured,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", config.id);
        if (error) throw error;
      } else {
        // First time insert
        const { error } = await supabase.from("email_config").insert({
          resend_api_key: values.resend_api_key,
          sender_name: values.sender_name,
          sender_email: values.sender_email,
          is_configured: isConfigured,
          updated_by: userId,
        });
        if (error) throw error;
      }

      await fetchConfig();
      return { success: true };
    } catch (err: any) {
      console.error("Error saving email config:", err);
      return { success: false, error: err.message };
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (recipientEmail: string): Promise<{ success: boolean; error?: string }> => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email-notification", {
        body: {
          recipient_email: recipientEmail,
          recipient_name: "Test User",
          subject: "Test Email — Atmosfair Sales Platform",
          message:
            "This is a test email from your notification system. If you received this, your Resend email configuration is working correctly!",
          is_automatic: false,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return { success: true };
    } catch (err: any) {
      console.error("Test email error:", err);
      return { success: false, error: err.message };
    } finally {
      setTesting(false);
    }
  };

  return { config, loading, saving, testing, saveConfig, testConnection };
}

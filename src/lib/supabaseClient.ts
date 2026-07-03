import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseAnonKey } from "./supabaseConfig";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

// Drop-in replacement for @supabase/auth-helpers-nextjs `createClientComponentClient()`.
export function createClientComponentClient(): SupabaseClient {
  return getSupabase();
}

export default getSupabase;


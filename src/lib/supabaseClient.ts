import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseAnonKey } from "./supabaseConfig";

let client: SupabaseClient | null = null;
let lazyClient: SupabaseClient | null = null;

function getInitializedClient(): SupabaseClient {
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

export function getSupabase(): SupabaseClient {
  if (!lazyClient) {
    // Several legacy service singletons call this function while route modules
    // are imported. A proxy keeps those imports SSR-safe and initializes the
    // browser client only when code actually accesses a Supabase API.
    lazyClient = new Proxy({} as SupabaseClient, {
      get(_target, property) {
        const initializedClient = getInitializedClient();
        const value = Reflect.get(initializedClient, property, initializedClient);
        return typeof value === "function" ? value.bind(initializedClient) : value;
      },
      set(_target, property, value) {
        return Reflect.set(getInitializedClient(), property, value);
      },
    });
  }
  return lazyClient;
}

// Drop-in replacement for @supabase/auth-helpers-nextjs `createClientComponentClient()`.
export function createClientComponentClient(): SupabaseClient {
  return getSupabase();
}

export default getSupabase;


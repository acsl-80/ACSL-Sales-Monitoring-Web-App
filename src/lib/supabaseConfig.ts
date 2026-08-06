// Central Supabase configuration for the project's Supabase instance.
//
// VITE_* values are public — they ship in the browser bundle. The URL and the
// anon/publishable key are NOT secrets; only the service-role key is. To keep the
// app resilient across sandbox resets and missing .env.local files, we ship safe
// hardcoded fallbacks here. Env vars still win when present.

// `import.meta.env` is absent in some SSR/serverless bundles, so guard the read.
// On the server (Vercel/Node) also consider process.env.
const viteEnv = ((typeof import.meta !== "undefined" && import.meta.env) || {}) as Record<
  string,
  string | undefined
>;
const nodeEnv = ((typeof process !== "undefined" && process.env) || {}) as Record<
  string,
  string | undefined
>;
const env: Record<string, string | undefined> = { ...nodeEnv, ...viteEnv };

// An env var that is *defined but blank* (a common Vercel dashboard slip) must
// count as missing. `??` only falls through on null/undefined, so `""` would
// otherwise win over the fallback and blow up createClient() at import time.
const pick = (...values: (string | undefined)[]): string | undefined =>
  values.find((v) => typeof v === "string" && v.trim() !== "")?.trim();

// Hardcoded fallbacks (safe to commit — these are the public anon credentials).
const FALLBACK_URL = "https://oeiwnpngbnkhcismhpgs.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9laXducG5nYm5raGNpc21ocGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0MDcyMDEsImV4cCI6MjA2Njk4MzIwMX0.Psuchp0nUS2VcKZrFTWPvXkO_JfV1f7QAhynhiZIuy0";

export const supabaseUrl: string =
  pick(
    env.VITE_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.REACT_APP_SUPABASE_URL
  ) ?? FALLBACK_URL;

export const supabaseAnonKey: string =
  pick(
    env.VITE_SUPABASE_ANON_KEY,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.REACT_APP_SUPABASE_ANON_KEY
  ) ?? FALLBACK_ANON_KEY;

export const isSupabaseConfigured: boolean =
  Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

export const supabaseFunctionsUrl = `${supabaseUrl}/functions/v1`;

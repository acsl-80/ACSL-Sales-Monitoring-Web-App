import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Helper to find common base name between organization names
function findBaseName(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];

  // Split all names into words
  const allWords = names.map((name) =>
    name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  );

  // Find common words across all names (excluding location indicators)
  const locationWords = new Set([
    "abuja",
    "lagos",
    "kano",
    "ibadan",
    "port",
    "harcourt",
    "kaduna",
    "benin",
    "maiduguri",
    "zaria",
    "aba",
    "jos",
    "ilorin",
    "oyo",
    "enugu",
    "abeokuta",
    "sokoto",
    "onitsha",
    "warri",
    "ebute",
    "metta",
    "yaba",
    "surulere",
    "ikeja",
    "lekki",
    "vi",
    "island",
    "mainland",
    "north",
    "south",
    "east",
    "west",
    "central",
    "branch",
    "office",
    "hq",
    "headquarters",
  ]);

  const firstWords = allWords[0];
  const commonWords = firstWords.filter((word) => {
    // Skip if it's a location word
    if (locationWords.has(word)) return false;

    // Check if this word appears in all other names
    return allWords.slice(1).every((words) => words.includes(word));
  });

  // If we have common words, use them as the base name
  if (commonWords.length > 0) {
    // Return the common words in the order they appear in the first name
    const baseWords: string[] = [];
    for (const word of firstWords) {
      if (commonWords.includes(word)) {
        baseWords.push(word);
      }
    }

    // Capitalize first letter of each word
    return baseWords
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // If no common words, return the shortest name as base
  return names.reduce((shortest, current) =>
    current.length < shortest.length ? current : shortest
  );
}

// Group organizations by similarity
function groupOrganizations(organizations: any[]): any[] {
  const groups: Map<string, any> = new Map();

  // First pass: create groups based on exact matches
  for (const org of organizations) {
    const key = org.partner_name.toLowerCase().trim();
    if (!groups.has(key)) {
      groups.set(key, {
        base_name: org.partner_name,
        branches: [],
        organization_ids: [],
      });
    }

    const group = groups.get(key)!;
    group.branches.push({
      id: org.id,
      branch: org.branch || "Main Branch",
      state: org.state,
      full_name: org.partner_name,
      partner_type: org.partner_type,
    });
    group.organization_ids.push(org.id);
  }

  // Second pass: merge similar organizations
  const groupKeys = Array.from(groups.keys());
  const merged: Set<string> = new Set();
  const finalGroups: Map<string, any> = new Map();

  for (let i = 0; i < groupKeys.length; i++) {
    const key1 = groupKeys[i];
    if (merged.has(key1)) continue;

    const similarKeys = [key1];
    const words1 = key1.split(/\s+/).filter((w) => w.length > 2);

    // Find similar organization names
    for (let j = i + 1; j < groupKeys.length; j++) {
      const key2 = groupKeys[j];
      if (merged.has(key2)) continue;

      const words2 = key2.split(/\s+/).filter((w) => w.length > 2);

      // Calculate similarity: count common words (length > 2)
      const common = words1.filter((w) => words2.includes(w));

      // If more than 50% of words match, consider them similar
      const minWords = Math.min(words1.length, words2.length);
      if (common.length >= Math.ceil(minWords * 0.5) && minWords > 1) {
        similarKeys.push(key2);
        merged.add(key2);
      }
    }

    merged.add(key1);

    // Merge all similar organizations
    const allBranches: any[] = [];
    const allOrgIds: string[] = [];
    const allNames: string[] = [];

    for (const key of similarKeys) {
      const group = groups.get(key)!;
      allBranches.push(...group.branches);
      allOrgIds.push(...group.organization_ids);
      allNames.push(group.base_name);
    }

    // Find the best base name
    const baseName = findBaseName(allNames);

    finalGroups.set(baseName, {
      base_name: baseName,
      branches: allBranches,
      organization_ids: allOrgIds,
      branch_count: allBranches.length,
    });
  }

  // Convert to array and sort alphabetically
  return Array.from(finalGroups.values()).sort((a, b) =>
    a.base_name.localeCompare(b.base_name)
  );
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authorization token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user role from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "super_admin") {
      throw new Error("Insufficient permissions");
    }

    // Get query parameters
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = parseInt(url.searchParams.get("page_size") || "30");

    // Build query
    let query = supabase
      .from("organizations")
      .select("id, partner_name, branch, state, partner_type", { count: "exact" });

    // Apply search filter
    if (search) {
      query = query.ilike("partner_name", `%${search}%`);
    }

    // Execute query
    const { data: organizations, error, count } = await query;

    if (error) {
      throw error;
    }

    // Group similar organizations
    const groupedOrgs = groupOrganizations(organizations || []);

    // Apply pagination to grouped results
    const totalGroups = groupedOrgs.length;
    const totalPages = Math.ceil(totalGroups / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedGroups = groupedOrgs.slice(startIndex, endIndex);

    return new Response(
      JSON.stringify({
        success: true,
        data: paginatedGroups,
        pagination: {
          page,
          page_size: pageSize,
          total_count: totalGroups,
          total_pages: totalPages,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.message === "Unauthorized" ? 401 : 500,
      }
    );
  }
});

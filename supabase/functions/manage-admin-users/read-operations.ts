// Read operations for admin users

export async function getAdminUser(supabase: any, adminUserId: string) {
  console.log(`📖 Fetching admin user: ${adminUserId}`);

  // Fetch admin user with organization details
  const { data: adminUser, error } = await supabase
    .from("profiles")
    .select(
      `
      id,
      full_name,
      email,
      role,
      organization_id,
      created_at,
      updated_at,
      organizations (
        id,
        name,
        partner_email,
        contact_phone,
        city,
        state,
        country,
        status
      )
    `
    )
    .eq("id", adminUserId)
    .eq("role", "admin")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new Error(`Admin user with ID ${adminUserId} not found`);
    }
    throw new Error(`Failed to fetch admin user: ${error.message}`);
  }

  return {
    data: adminUser,
    message: "Admin user retrieved successfully",
  };
}

export async function getAdminUsers(
  supabase: any,
  searchParams: URLSearchParams
) {
  console.log("📖 Fetching admin users...");

  // Parse pagination parameters
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  // Parse filter parameters
  const organizationId = searchParams.get("organization_id");
  const search = searchParams.get("search");
  const status = searchParams.get("status");

  // Build query
  let query = supabase
    .from("profiles")
    .select(
      `
      id,
      full_name,
      email,
      role,
      organization_id,
      created_at,
      updated_at,
      organizations (
        id,
        name,
        partner_email,
        contact_phone,
        city,
        state,
        country,
        status
      )
    `
    )
    .eq("role", "admin")
    .order("created_at", { ascending: false });

  // Apply filters
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  // Apply pagination
  query = query.range(offset, offset + limit - 1);

  const { data: adminUsers, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch admin users: ${error.message}`);
  }

  // Get total count for pagination
  const { count: totalCount, error: countError } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");

  if (countError) {
    console.warn("Failed to get total count:", countError.message);
  }

  const totalPages = Math.ceil((totalCount || adminUsers?.length || 0) / limit);

  return {
    data: adminUsers || [],
    pagination: {
      page,
      limit,
      total: totalCount || adminUsers?.length || 0,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    message: "Admin users retrieved successfully",
  };
}

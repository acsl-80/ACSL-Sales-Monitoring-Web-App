// Read operations for stove ID management

export async function getStoveIds(
  supabase: any,
  userRole: string,
  organizationId: string | null,
  searchParams: URLSearchParams,
  allowedOrgIds: string[] | null = null
) {
  console.log("📖 Fetching stove IDs...");
  console.log(`User role: ${userRole}, Organization ID: ${organizationId}`);

  // Parse pagination parameters
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("page_size") || "25");
  const offset = (page - 1) * pageSize;

  // Parse filter parameters
  const stoveIdFilter = searchParams.get("stove_id") || "";
  const statusFilter = searchParams.get("status") || "";
  const organizationName = searchParams.get("organization_name") || "";
  const organizationIds =
    searchParams.get("organization_ids")?.split(",") || [];
  const branchFilter = searchParams.get("branch") || "";
  const stateFilter = searchParams.get("state") || "";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";
  const showArchived = searchParams.get("show_archived") === "true";

  console.log(
    `Pagination: page=${page}, pageSize=${pageSize}, offset=${offset}`
  );
  console.log(
    `Filters: stoveId=${stoveIdFilter}, status=${statusFilter}, org=${organizationName}, orgIds=${organizationIds.join(
      ","
    )}, branch=${branchFilter}, state=${stateFilter}, dateFrom=${dateFrom}, dateTo=${dateTo}, showArchived=${showArchived}`
  );

  // Build the base query
  let query = supabase.from("stove_ids").select(
    `
      id,
      stove_id,
      sale_id,
      organization_id,
      status,
      sales_reference,
      is_archived,
      archive_note,
      created_at,
      organizations!inner (
        id,
        partner_name,
        branch,
        state
      ),
      sales!left (
        id,
        end_user_name,
        sales_date,
        created_at
      )
    `,
    { count: "exact" }
  );

  // Apply role-based filtering
  if ((userRole === "partner" || userRole === "admin") && organizationId) {
    console.log(`🔒 Partner user - filtering by organization: ${organizationId}`);
    query = query.eq("organization_id", organizationId);
  } else if (userRole === "super_admin") {
    console.log("🔓 Super admin - accessing all stove IDs");
  } else if (userRole === "acsl_agent" || userRole === "super_admin_agent") {
    // SAA: scope to their assigned orgs; intersect with client-provided org filter
    const effectiveOrgIds =
      allowedOrgIds && allowedOrgIds.length > 0
        ? organizationIds.length > 0
          ? organizationIds.filter((id) => allowedOrgIds!.includes(id))
          : allowedOrgIds
        : [];
    if (effectiveOrgIds.length === 0) {
      return {
        data: [],
        pagination: { page, page_size: pageSize, total_count: 0, total_pages: 0 },
      };
    }
    console.log(`🔒 SAA - filtering by assigned orgs: ${effectiveOrgIds.join(",")}`);
    query = query.in("organization_id", effectiveOrgIds);
  } else {
    throw new Error("Unauthorized: Invalid role or missing organization");
  }

  // Apply archive filter - default to showing only non-archived
  if (!showArchived) {
    query = query.eq("is_archived", false);
  } else {
    // If showArchived is true, we might want to show ONLY archived or BOTH.
    // Usually, "Show Archived" means show everything including archived,
    // or specifically just the archived ones.
    // The user said: "until when i click my filter to show archived stove that is when it will show"
    // I'll assume showArchived=true means show ONLY archived stove IDs.
    query = query.eq("is_archived", true);
  }

  // Apply filters
  if (stoveIdFilter) {
    query = query.ilike("stove_id", `%${stoveIdFilter}%`);
  }

  const salesReferenceFilter = searchParams.get("sales_reference") || "";
  if (salesReferenceFilter) {
    query = query.ilike("sales_reference", `%${salesReferenceFilter}%`);
  }

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  // Filter by organization IDs (for grouped organization selection — super_admin only)
  if (organizationIds.length > 0 && userRole === "super_admin") {
    query = query.in("organization_id", organizationIds);
  }

  // Legacy organization name filter (fallback)
  if (organizationName && userRole === "super_admin") {
    query = query.ilike("organizations.partner_name", `%${organizationName}%`);
  }

  if (branchFilter && userRole === "super_admin") {
    query = query.ilike("organizations.branch", `%${branchFilter}%`);
  }

  if (stateFilter && userRole === "super_admin") {
    query = query.ilike("organizations.state", `%${stateFilter}%`);
  }

  if (dateFrom) {
    // Start of day: 2026-01-13 00:00:00
    query = query.gte("created_at", `${dateFrom}T00:00:00`);
  }

  if (dateTo) {
    // End of day: 2026-01-13 23:59:59
    query = query.lte("created_at", `${dateTo}T23:59:59`);
  }

  // Apply ordering
  const sortByParam = searchParams.get("sort_by") || "created_at";
  const sortDirParam = searchParams.get("sort_dir") || "desc";
  const ascending = sortDirParam === "asc";

  const sortColumnMap: Record<string, string> = {
    stove_id: "stove_id",
    date_sold: "created_at",
    created_at: "created_at",
    status: "status",
    sales_reference: "sales_reference",
  };
  const sortColumn = sortColumnMap[sortByParam] || "created_at";

  query = query
    .order(sortColumn, { ascending })
    .range(offset, offset + pageSize - 1);

  // Execute query
  const { data, error, count } = await query;

  if (error) {
    console.error("❌ Error fetching stove IDs:", error);
    throw new Error(`Failed to fetch stove IDs: ${error.message}`);
  }

  console.log(
    `✅ Found ${count} total stove IDs, returning ${
      data?.length || 0
    } for current page`
  );

  // Transform data to include calculated fields
  const transformedData = data?.map((item: any) => {
    // Handle both object (FK from stove_ids.sale_id) and array (FK from sales side)
    const saleRaw = item.sales;
    const sale = saleRaw
      ? Array.isArray(saleRaw) ? saleRaw[0] || null : saleRaw
      : null;

    return {
      id: item.id,
      stove_id: item.stove_id,
      status: item.status,
      created_at: item.created_at,
      organization_id: item.organization_id,
      organization_name: item.organizations?.partner_name || "N/A",
      branch: item.organizations?.branch || "N/A",
      location: item.organizations?.state || "N/A",
      sale_id: item.sale_id || sale?.id || null,
      sale_date: sale?.sales_date || sale?.created_at || null,
      sold_to: sale?.end_user_name || null,
      sales_reference: item.sales_reference || null,
      is_archived: item.is_archived || false,
      archive_note: item.archive_note || null,
    };
  });

  return {
    data: transformedData,
    pagination: {
      page,
      page_size: pageSize,
      total_count: count || 0,
      total_pages: Math.ceil((count || 0) / pageSize),
    },
  };
}

// Get stove IDs grouped by sales_reference
export async function getGroupedBySalesReference(
  supabase: any,
  userRole: string,
  organizationId: string | null,
  searchParams: URLSearchParams,
  allowedOrgIds: string[] | null = null
) {
  console.log("📊 Fetching stove IDs grouped by sales_reference...");

  const organizationIds = searchParams.get("organization_ids")?.split(",").filter(Boolean) || [];

  let query = supabase.from("stove_ids").select(`
    id,
    stove_id,
    organization_id,
    status,
    sales_reference,
    created_at,
    is_archived,
    organizations!inner (
      id,
      partner_name,
      branch,
      state
    ),
    sales!left (
      id,
      end_user_name,
      sales_date,
      created_at
    )
  `).eq("is_archived", false);

  // Apply role-based filtering
  if ((userRole === "partner" || userRole === "admin") && organizationId) {
    query = query.eq("organization_id", organizationId);
  } else if (userRole === "super_admin") {
    if (organizationIds.length > 0) {
      query = query.in("organization_id", organizationIds);
    }
  } else if (userRole === "acsl_agent" || userRole === "super_admin_agent") {
    const effectiveOrgIds =
      allowedOrgIds && allowedOrgIds.length > 0
        ? organizationIds.length > 0
          ? organizationIds.filter((id) => allowedOrgIds!.includes(id))
          : allowedOrgIds
        : [];
    if (effectiveOrgIds.length === 0) return { data: [] };
    query = query.in("organization_id", effectiveOrgIds);
  } else {
    throw new Error("Unauthorized: Invalid role or missing organization");
  }

  const { data, error } = await query.order("sales_reference", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });

  if (error) {
    console.error("❌ Error fetching grouped stove IDs:", error);
    throw new Error(`Failed to fetch grouped stove IDs: ${error.message}`);
  }

  // Group by sales_reference
  const grouped: Record<string, any> = {};
  for (const item of data || []) {
    const ref = item.sales_reference || "__no_reference__";
    if (!grouped[ref]) {
      grouped[ref] = {
        sales_reference: item.sales_reference || null,
        stove_ids: [],
        total: 0,
        available: 0,
        sold: 0,
      };
    }
    const saleRaw = item.sales;
    const sale = saleRaw
      ? Array.isArray(saleRaw) ? saleRaw[0] || null : saleRaw
      : null;

    grouped[ref].stove_ids.push({
      id: item.id,
      stove_id: item.stove_id,
      status: item.status,
      organization_name: item.organizations?.partner_name || "N/A",
      branch: item.organizations?.branch || "N/A",
      location: item.organizations?.state || "N/A",
      sale_date: sale?.sales_date || sale?.created_at || null,
      sold_to: sale?.end_user_name || null,
      created_at: item.created_at,
    });
    grouped[ref].total++;
    if (item.status === "available") grouped[ref].available++;
    else if (item.status === "sold") grouped[ref].sold++;
  }

  // Sort: named references first, then null references
  const sortedGroups = Object.values(grouped).sort((a: any, b: any) => {
    if (!a.sales_reference && b.sales_reference) return 1;
    if (a.sales_reference && !b.sales_reference) return -1;
    return (a.sales_reference || "").localeCompare(b.sales_reference || "");
  });

  console.log(`✅ Grouped into ${sortedGroups.length} sales reference groups`);
  return { data: sortedGroups };
}

// Get single stove ID by ID
export async function getStoveIdById(
  supabase: any,
  userRole: string,
  organizationId: string | null,
  stoveIdParam: string,
  allowedOrgIds: string[] | null = null
) {
  console.log(`📖 Fetching stove ID with ID: ${stoveIdParam}`);
  console.log(`User role: ${userRole}, Organization ID: ${organizationId}`);

  // Build the query
  let query = supabase
    .from("stove_ids")
    .select(
      `
      id,
      stove_id,
      sale_id,
      organization_id,
      status,
      is_archived,
      archive_note,
      created_at,
      organizations!inner (
        id,
        partner_name,
        branch,
        state,
        address,
        email,
        contact_person,
        contact_phone
      ),
      sales!left (
        id,
        end_user_name,
        phone,
        sales_date,
        created_at,
        transaction_id,
        amount,
        state_backup,
        lga_backup,
        is_installment,
        payment_status
      )
    `
    )
    .eq("id", stoveIdParam)
    .single();

  // Execute query
  const { data, error } = await query;

  if (error) {
    console.error("❌ Error fetching stove ID:", error);
    throw new Error(`Failed to fetch stove ID: ${error.message}`);
  }

  if (!data) {
    throw new Error("Stove ID not found");
  }

  // Check authorization
  if ((userRole === "partner" || userRole === "admin") && data.organization_id !== organizationId) {
    throw new Error(
      "Unauthorized: You can only view stove IDs from your organization"
    );
  }
  if (
    (userRole === "acsl_agent" || userRole === "super_admin_agent") &&
    allowedOrgIds &&
    !allowedOrgIds.includes(data.organization_id)
  ) {
    throw new Error(
      "Unauthorized: You can only view stove IDs from your assigned organizations"
    );
  }

  console.log(`✅ Found stove ID: ${data.stove_id}`);

  // Transform data — handle both object and array from sales join
  const saleRaw = data.sales;
  const sale = saleRaw
    ? Array.isArray(saleRaw) ? saleRaw[0] || null : saleRaw
    : null;

  return {
    id: data.id,
    stove_id: data.stove_id,
    status: data.status,
    created_at: data.created_at,
    organization_id: data.organization_id,
    organization_name: data.organizations?.partner_name || "N/A",
    branch: data.organizations?.branch || "N/A",
    location: data.organizations?.state || "N/A",
    address: data.organizations?.address || "N/A",
    email: data.organizations?.email || "N/A",
    contact_name: data.organizations?.contact_person || "N/A",
    contact_phone: data.organizations?.contact_phone || "N/A",
    sale_id: data.sale_id || sale?.id || null,
    sale_date: sale?.sales_date || sale?.created_at || null,
    sold_to: sale?.end_user_name || null,
    is_archived: data.is_archived || false,
    archive_note: data.archive_note || null,
    // Pass full sale object so the modal can use it directly
    sale: sale || null,
  };
}

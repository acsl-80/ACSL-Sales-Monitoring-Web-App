// CRUD operations for organizations

// Read operations for organizations with admin user information
import { selectInChunks, paginatedSelectInChunks } from "../_shared/chunkedQuery.ts";

export async function getOrganization(supabase: any, organizationId: string) {
  console.log(`🔍 Getting organization with admin user: ${organizationId}`);

  // First get the organization - using new 8-field structure
  const { data: organization, error } = await supabase
    .from("organizations")
    .select(
      `
      id,
      partner_id,
      partner_name,
      branch,
      state,
      contact_person,
      contact_phone,
      alternative_phone,
      email,
      address,
      created_at,
      updated_at,
      created_by,
      updated_by
    `,
    )
    .eq("id", organizationId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new Error(`Organization with ID ${organizationId} not found`);
    }
    throw new Error(`Failed to fetch organization: ${error.message}`);
  }

  // Get the admin user for this organization
  let adminUser = null;
  try {
    const { data: admin, error: adminError } = await supabase
      .from("profiles")
      .select(
        `
        id,
        email,
        full_name,
        phone,
        role,
        has_changed_password,
        created_at
      `,
      )
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .limit(1)
      .single();

    if (!adminError && admin) {
      adminUser = admin;
    }
  } catch (adminError) {
    console.warn("Could not fetch admin user:", adminError);
  }

  // Sales models assigned to this partner, as bare IDs — see the bulk read in
  // getOrganizations for why clients resolve them locally.
  let paymentModelIds: string[] | null = null;
  try {
    const { data: modelLinks, error: modelLinksError } = await supabase
      .from("organization_payment_models")
      .select("payment_model_id")
      .eq("organization_id", organizationId);

    if (modelLinksError) throw modelLinksError;
    paymentModelIds = (modelLinks || []).map((l: any) => l.payment_model_id);
  } catch (modelError) {
    console.warn("Could not fetch payment model assignments:", modelError);
  }

  return {
    data: {
      organization: { ...organization, payment_model_ids: paymentModelIds },
      admin_user: adminUser,
    },
    message: "Organization retrieved successfully",
  };
}

export async function getOrganizations(
  supabase: any,
  searchParams: URLSearchParams,
  allowedOrgIds: string[] | null = null,
) {
  console.log("🔍 Getting all organizations with admin users...");

  // Scoped roles with no assignments see an empty (but identically shaped) result
  if (allowedOrgIds && allowedOrgIds.length === 0) {
    const limitEmpty = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offsetEmpty = parseInt(searchParams.get("offset") || "0");
    return {
      data: [],
      pagination: { limit: limitEmpty, offset: offsetEmpty, total: 0, totalPages: 0 },
      message: "No organizations found",
    };
  }

  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const partnerType = searchParams.get("partner_type");
  const stateFilter = searchParams.get("state");
  const branchFilter = searchParams.get("branch");
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const includeAdminUsers = searchParams.get("include_admin_users") !== "false"; // Default to true

  const stoveSortFields = ["sold_stove_ids", "total_stove_ids", "available_stove_ids"];
  const isStoveSort = stoveSortFields.includes(sortBy);

  // Validate sortBy to prevent SQL injection
  const validSortFields = [
    "created_at",
    "updated_at",
    "partner_name",
    "branch",
    "state",
  ];
  const actualSortBy = validSortFields.includes(sortBy) ? sortBy : "created_at";

  // Validate sortOrder
  const actualSortOrder = sortOrder === "asc" ? "asc" : "desc";

  // Helper to apply shared filters to any query. Org scoping (allowedOrgIds,
  // which can be hundreds of orgs for an ACSL agent) is applied SEPARATELY, in
  // chunks, so it never overflows the request URL — see scoped helpers below.
  const applyFilters = (q: any) => {
    if (search) {
      // The value goes into a raw PostgREST `or()` expression, where `(`, `)`,
      // `,` and `.` are syntax. An unescaped partner name like
      // "Swali Global Multi Concept (Amina Sales Model)" gets mis-parsed and the
      // search silently matches the wrong set. Double-quoting makes PostgREST
      // treat the whole thing as a literal.
      const s = search.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      // `*` and `%` both work as the wildcard here. An earlier version of this
      // comment claimed `%` inside quotes matches a literal percent sign, and
      // that is not what PostgREST 14.15 does. Tested against production on
      // 2026-08-20, searching "Abdu" across 7 matching partners:
      //
      //   SQL       ilike '%Abdu%'                 7 rows
      //   PostgREST partner_name.ilike."%Abdu%"    7 rows
      //   PostgREST partner_name.ilike."*Abdu*"    7 rows
      //
      // If `%` were literal the middle one would return 0. `*` is kept because
      // it is the documented form and there is no reason to churn a live
      // function, but nothing was broken by the other one.
      q = q.or(`partner_name.ilike."*${s}*",partner_id.ilike."*${s}*"`);
    }
    if (status) q = q.eq("status", status);
    if (partnerType) q = q.ilike("partner_type", partnerType);
    if (stateFilter) q = q.ilike("state", stateFilter);
    if (branchFilter) q = q.ilike("branch", `%${branchFilter}%`);
    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");
    return q;
  };

  // ── Stove-based sort path ──────────────────────────────────────────────────
  if (isStoveSort) {
    // Step 1: get all matching org IDs (no pagination limit). Scope by
    // allowedOrgIds in chunks to keep the request URL small.
    const { data: allIdRows, error: idsError } = allowedOrgIds
      ? await selectInChunks(allowedOrgIds, (c) =>
          applyFilters(supabase.from("organizations").select("id")).in("id", c)
        )
      : await applyFilters(supabase.from("organizations").select("id"));
    if (idsError) throw new Error(`Failed to fetch org IDs: ${idsError.message}`);

    const allOrgIds: string[] = (allIdRows || []).map((r: any) => r.id);
    const totalCount = allOrgIds.length;

    if (totalCount === 0) {
      return {
        data: [],
        pagination: { limit, offset, total: 0, totalPages: 0 },
        message: "No organizations found",
      };
    }

    // Step 2: get stove counts for all matching orgs
    let countsByOrg: Record<string, { total: number; sold: number; available: number }> = {};
    try {
      const { data: rpcCounts, error: rpcErr } = await supabase.rpc(
        "get_organization_stove_counts",
        { org_ids: allOrgIds },
      );
      if (!rpcErr && rpcCounts) {
        for (const row of rpcCounts) {
          countsByOrg[row.organization_id] = {
            total: row.total_count || 0,
            sold: row.sold_count || 0,
            available: row.available_count || 0,
          };
        }
      }
    } catch (_) {
      // fallback: query stove_ids table directly (chunk the org list)
      const { data: stoveRows } = await selectInChunks(allOrgIds, (c) =>
        supabase.from("stove_ids").select("organization_id, status").in("organization_id", c)
      );
      for (const row of stoveRows || []) {
        const id = row.organization_id;
        if (!countsByOrg[id]) countsByOrg[id] = { total: 0, sold: 0, available: 0 };
        countsByOrg[id].total += 1;
        if (row.status === "sold") countsByOrg[id].sold += 1;
        else countsByOrg[id].available += 1;
      }
    }

    // Step 3: sort IDs by stove count
    const sortKey = sortBy === "sold_stove_ids" ? "sold" : sortBy === "total_stove_ids" ? "total" : "available";
    const sortedIds = [...allOrgIds].sort((a, b) => {
      const va = countsByOrg[a]?.[sortKey] ?? 0;
      const vb = countsByOrg[b]?.[sortKey] ?? 0;
      return actualSortOrder === "asc" ? va - vb : vb - va;
    });

    // Step 4: paginate
    const pageIds = sortedIds.slice(offset, offset + limit);

    // Step 5: fetch full org details for this page
    const { data: pageOrgs, error: pageErr } = await supabase
      .from("organizations")
      .select(`id, partner_id, partner_name, partner_type, branch, state, contact_person, contact_phone, alternative_phone, email, address, created_at, updated_at, created_by, updated_by`)
      .in("id", pageIds);
    if (pageErr) throw new Error(`Failed to fetch page orgs: ${pageErr.message}`);

    // Step 6: attach counts, restore sorted order
    const orgById: Record<string, any> = {};
    for (const org of pageOrgs || []) orgById[org.id] = org;

    const result = pageIds.map((id) => ({
      ...orgById[id],
      total_stove_ids: countsByOrg[id]?.total ?? 0,
      sold_stove_ids: countsByOrg[id]?.sold ?? 0,
      available_stove_ids: countsByOrg[id]?.available ?? 0,
    }));

    return {
      data: result,
      pagination: {
        limit,
        offset,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      message: `Retrieved ${result.length} organizations (sorted by ${sortBy})`,
    };
  }

  // ── Normal sort path ───────────────────────────────────────────────────────
  const orgSelectColumns = `
      id,
      partner_id,
      partner_name,
      partner_type,
      branch,
      state,
      contact_person,
      contact_phone,
      alternative_phone,
      email,
      address,
      created_at,
      updated_at,
      created_by,
      updated_by
    `;
  let query = supabase.from("organizations").select(orgSelectColumns, { count: "exact" });

  let organizations: any[];
  let error: any;
  let count: number;

  if (allowedOrgIds) {
    // Scoped caller: chunk the (potentially huge) org list, merge + sort + page.
    const asc = actualSortOrder === "asc";
    const compare = (a: any, b: any) => {
      const av = a?.[actualSortBy], bv = b?.[actualSortBy];
      let c = av == null && bv == null ? 0 : av == null ? 1 : bv == null ? -1 : av < bv ? -1 : av > bv ? 1 : 0;
      if (!asc) c = -c;
      if (c !== 0) return c;
      return a?.id < b?.id ? -1 : a?.id > b?.id ? 1 : 0;
    };
    const res = await paginatedSelectInChunks(
      allowedOrgIds,
      (c) => applyFilters(supabase.from("organizations").select(orgSelectColumns, { count: "exact" })).in("id", c).order(actualSortBy, { ascending: asc }),
      { offset, limit, compare },
    );
    organizations = res.data;
    count = res.count;
    error = res.error;
  } else {
    query = applyFilters(query)
      .order(actualSortBy, { ascending: actualSortOrder === "asc" })
      .range(offset, offset + limit - 1);
    const r = await query;
    organizations = r.data;
    error = r.error;
    count = r.count || 0;
  }

  if (error) {
    throw new Error(`Failed to fetch organizations: ${error.message}`);
  }

  // If requested, fetch admin users for each organization
  let organizationsWithAdmins = organizations;

  if (includeAdminUsers && organizations && organizations.length > 0) {
    console.log("📋 Fetching admin users for organizations...");

    try {
      // Get all admin users for these organizations in one query
      const orgIds = organizations.map((org: any) => org.id);

      const { data: adminUsers, error: adminError } = await supabase
        .from("profiles")
        .select(
          `
          id,
          email,
          full_name,
          phone,
          role,
          has_changed_password,
          created_at,
          organization_id
        `,
        )
        .in("organization_id", orgIds)
        .eq("role", "admin");

      if (!adminError && adminUsers) {
        // Create a map of organization_id -> admin_user
        const adminMap = new Map();
        adminUsers.forEach((admin: any) => {
          adminMap.set(admin.organization_id, admin);
        });

        // Add admin user data to each organization
        organizationsWithAdmins = organizations.map((org: any) => ({
          ...org,
          admin_user: adminMap.get(org.id) || null,
        }));
      } else {
        console.warn("Could not fetch admin users:", adminError);
        // Still return organizations without admin data if admin fetch fails
        organizationsWithAdmins = organizations.map((org: any) => ({
          ...org,
          admin_user: null,
        }));
      }
    } catch (adminFetchError) {
      console.error("Error fetching admin users:", adminFetchError);
      // Return organizations without admin data if there's an error
      organizationsWithAdmins = organizations.map((org: any) => ({
        ...org,
        admin_user: null,
      }));
    }
  }

  // Attach each organization's assigned sales models as a bare ID list.
  // Clients (web + mobile) already hold the full payment_models catalogue, so
  // they resolve these IDs locally at point of sale — one bulk query here
  // replaces a per-partner lookup, and the list caches offline on mobile.
  if (organizations && organizations.length > 0) {
    try {
      const orgIds = organizations.map((org: any) => org.id);

      const { data: modelLinks, error: modelLinksError } = await supabase
        .from("organization_payment_models")
        .select("organization_id, payment_model_id")
        .in("organization_id", orgIds);

      if (modelLinksError) throw modelLinksError;

      const modelMap = new Map<string, string[]>();
      for (const link of modelLinks || []) {
        const list = modelMap.get(link.organization_id) || [];
        list.push(link.payment_model_id);
        modelMap.set(link.organization_id, list);
      }

      organizationsWithAdmins = organizationsWithAdmins.map((org: any) => ({
        ...org,
        payment_model_ids: modelMap.get(org.id) || [],
      }));
    } catch (modelError) {
      console.error("Error fetching payment model assignments:", modelError);
      // An empty list means "no installment models" downstream, which would
      // silently hide models the partner really has. Send null so clients can
      // tell a genuine empty assignment apart from a failed lookup.
      organizationsWithAdmins = organizationsWithAdmins.map((org: any) => ({
        ...org,
        payment_model_ids: null,
      }));
    }
  }

  // Fetch stove ID counts for each organization
  if (organizations && organizations.length > 0) {
    console.log("📦 Fetching stove ID counts for organizations...");

    try {
      const orgIds = organizations.map((org: any) => org.id);

      // Use RPC call or aggregation to count stove IDs efficiently
      // This is much more efficient than fetching all records
      const { data: stoveCounts, error: stoveCountError } = await supabase.rpc(
        "get_organization_stove_counts",
        { org_ids: orgIds },
      );

      if (stoveCountError) {
        console.error(
          "Error calling get_organization_stove_counts RPC:",
          stoveCountError,
        );
        // Fallback to manual counting if RPC fails
        throw stoveCountError;
      }

      // Create maps from RPC results
      const countMap = new Map();
      stoveCounts?.forEach((item: any) => {
        countMap.set(item.organization_id, {
          total: item.total_count || 0,
          sold: item.sold_count || 0,
          available: item.available_count || 0,
        });
      });

      // Add stove ID counts to organizations
      organizationsWithAdmins = organizationsWithAdmins.map((org: any) => {
        const counts = countMap.get(org.id) || {
          total: 0,
          sold: 0,
          available: 0,
        };
        return {
          ...org,
          total_stove_ids: counts.total,
          sold_stove_ids: counts.sold,
          available_stove_ids: counts.available,
        };
      });
    } catch (stoveCountError) {
      console.error("Error fetching stove ID counts, using fallback method:", stoveCountError);
      
      // Fallback: single bulk query, aggregate in JS
      try {
        const orgIds = organizations.map((org: any) => org.id);

        const { data: stoveRows, error: bulkErr } = await supabase
          .from("stove_ids")
          .select("organization_id, status")
          .in("organization_id", orgIds);

        if (bulkErr) throw bulkErr;

        const totalMap = new Map<string, number>();
        const soldMap = new Map<string, number>();
        const availableMap = new Map<string, number>();

        for (const row of stoveRows || []) {
          const id = row.organization_id;
          totalMap.set(id, (totalMap.get(id) || 0) + 1);
          if (row.status === "sold") soldMap.set(id, (soldMap.get(id) || 0) + 1);
          else availableMap.set(id, (availableMap.get(id) || 0) + 1);
        }

        organizationsWithAdmins = organizationsWithAdmins.map((org: any) => ({
          ...org,
          total_stove_ids: totalMap.get(org.id) || 0,
          sold_stove_ids: soldMap.get(org.id) || 0,
          available_stove_ids: availableMap.get(org.id) || 0,
        }));
      } catch (fallbackError) {
        console.error("Fallback method also failed:", fallbackError);
        // Return organizations with zero counts if everything fails
        organizationsWithAdmins = organizationsWithAdmins.map((org: any) => ({
          ...org,
          total_stove_ids: 0,
          sold_stove_ids: 0,
          available_stove_ids: 0,
        }));
      }
    }
  }

  return {
    data: organizationsWithAdmins,
    pagination: {
      limit,
      offset,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
    },
    message: `Retrieved ${organizationsWithAdmins?.length || 0} organizations${
      includeAdminUsers ? " with admin user data" : ""
    }`,
  };
}

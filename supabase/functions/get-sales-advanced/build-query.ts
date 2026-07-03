// Query building module
import { Filters } from "./parse-filters.ts";

export interface QueryResult {
  sales: any[] | null;
  totalRecords: number | null;
}

export async function buildQuery(
  supabase: any,
  filters: Filters,
  userRole: string,
  userOrgId: string | null,
  assignedOrgIds?: string[],
  userId?: string,
  teamAgentIds?: string[]
): Promise<QueryResult> {
  console.log("🔍 Building optimized sales query with joins...");

  // Test basic table access first
  console.log("🧪 Testing table access...");
  const { data: testData, error: testError } = await supabase
    .from("sales")
    .select("id, created_at, organization_id")
    .limit(1);

  if (testError) {
    console.log("❌ Table access test failed:", testError.message);
    throw new Error(`Table access failed: ${testError.message}`);
  }

  console.log("✅ Table accessible");

  // Build optimized select with LEFT JOINs to reduce separate queries
  const selectFields = buildOptimizedSelectFields(filters);
  console.log("📋 Using optimized fields with joins");

  // Start building query with joins
  let query = supabase.from("sales").select(selectFields, { count: "exact" });

  // Apply all filters
  query = applyAllFilters(query, filters, userRole, userOrgId, assignedOrgIds, userId, teamAgentIds);

  console.log("🚀 Executing optimized query with joins...");

  // Execute query with pagination
  const limit = Math.min(filters.limit || 100, 500);
  const offset = filters.offset || ((filters.page || 1) - 1) * limit;

  const {
    data: sales,
    error,
    count: totalRecords,
  } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error("❌ Main query failed:", error.message);
    throw new Error(`Database query failed: ${error.message}`);
  }

  console.log(
    `✅ Query successful: ${sales?.length || 0} records, ${totalRecords} total`
  );

  return { sales, totalRecords };
}

function buildOptimizedSelectFields(filters: Filters): string {
  // Base sales fields
  const baseFields = [
    "id",
    "transaction_id",
    "stove_serial_no",
    "sales_date",
    "contact_person",
    "contact_phone",
    "end_user_name",
    "aka",
    "state_backup",
    "lga_backup",
    "phone",
    "other_phone",
    "partner_name",
    "amount",
    "signature",
    "created_by",
    "organization_id",
    "address_id",
    "stove_image_id",
    "agreement_image_id",
    "created_at",
    "status",
    "agent_approved",
    "agent_approved_at",
    "agent_approved_by",
    "is_installment",
    "payment_model_id",
    "total_paid",
    "payment_status",
    "is_archived",
    "retailer_branch",
    "pot_quantity",
    "heat_retention_device",
    "previous_stove_type",
    "previous_stove_other",
    "meals_per_day",
    "cooking_fuel_source",
    "cooking_location",
    "terms_accepted",
  ];

  // Add joins based on what's requested to avoid N+1 queries
  const joinFields: string[] = [];

  // Use LEFT JOIN so sales without an organization_id (e.g. legacy records) are still returned
  joinFields.push(
    "organizations!left(id, partner_name, branch, state, email)"
  );

  // Always include payment model info for installment sales
  joinFields.push(
    "payment_model:payment_models!left(id, name, duration_months, fixed_price)"
  );

  // Include address if specifically requested
  if (filters.includeAddress) {
    joinFields.push(
      "addresses(id, city, state, street, country, latitude, longitude, full_address)"
    );
  }

  // Creator is fetched separately in fetchRelatedData (fetchCreators) to avoid FK hint issues.
  // Do NOT add a profiles join here — it depends on a FK constraint name that may not match.

  // Include images if specifically requested
  if (
    filters.includeImages ||
    filters.includeStoveImage ||
    filters.includeAgreementImage
  ) {
    joinFields.push(
      "stove_image:uploads!stove_image_id(id, public_id, url, type)",
      "agreement_image:uploads!agreement_image_id(id, public_id, url, type)"
    );
  }

  return [...baseFields, ...joinFields].join(", ");
}

function applyAllFilters(
  query: any,
  filters: Filters,
  userRole: string,
  userOrgId: string | null,
  assignedOrgIds?: string[],
  userId?: string,
  teamAgentIds?: string[]
) {
  // Apply filters in order of selectivity (most selective first)
  query = applyOrganizationFilters(query, filters, userRole, userOrgId, assignedOrgIds, userId, teamAgentIds);
  query = applyDateFilters(query, filters);
  query = applyStoveFilters(query, filters);
  query = applyStatusFilters(query, filters);
  query = applyLocationFilters(query, filters);
  query = applyPeopleFilters(query, filters);
  query = applyAmountFilters(query, filters);
  query = applyBooleanFilters(query, filters);
  query = applySearchFilter(query, filters);
  query = applySorting(query, filters);

  return query;
}

function applyDateFilters(query: any, filters: Filters) {
  console.log("📅 Applying date filters...");

  // Sales date filters
  if (filters.dateFrom) query = query.gte("sales_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("sales_date", filters.dateTo);

  // Created date filters
  if (filters.createdFrom) query = query.gte("created_at", filters.createdFrom);
  if (filters.createdTo) query = query.lte("created_at", filters.createdTo);

  // Quick date filters
  const now = new Date();
  if (filters.lastNDays) {
    const pastDate = new Date(
      now.getTime() - filters.lastNDays * 24 * 60 * 60 * 1000
    );
    query = query.gte("created_at", pastDate.toISOString());
  }
  if (filters.thisWeek) {
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    query = query.gte("created_at", startOfWeek.toISOString());
  }
  if (filters.thisMonth) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    query = query.gte("created_at", startOfMonth.toISOString());
  }
  if (filters.thisYear) {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    query = query.gte("created_at", startOfYear.toISOString());
  }

  return query;
}

function applyLocationFilters(query: any, filters: Filters) {
  if (filters.state) query = query.eq("state_backup", filters.state);
  if (filters.states?.length) query = query.in("state_backup", filters.states);
  if (filters.lga) query = query.eq("lga_backup", filters.lga);
  if (filters.lgas?.length) query = query.in("lga_backup", filters.lgas);
  return query;
}

function applyStoveFilters(query: any, filters: Filters) {
  if (filters.stoveSerialNo)
    query = query.eq("stove_serial_no", filters.stoveSerialNo);
  if (filters.stoveSerialNos?.length)
    query = query.in("stove_serial_no", filters.stoveSerialNos);
  if (filters.stoveSerialNoPattern) {
    query = query.like("stove_serial_no", `%${filters.stoveSerialNoPattern}%`);
  }
  return query;
}

function applyPeopleFilters(query: any, filters: Filters) {
  if (filters.contactPerson)
    query = query.ilike("contact_person", `%${filters.contactPerson}%`);
  if (filters.contactPhone)
    query = query.eq("contact_phone", filters.contactPhone);
  if (filters.endUserName)
    query = query.ilike("end_user_name", `%${filters.endUserName}%`);
  if (filters.aka) query = query.ilike("aka", `%${filters.aka}%`);
  if (filters.partnerName)
    query = query.ilike("partner_name", `%${filters.partnerName}%`);
  if (filters.createdBy) query = query.eq("created_by", filters.createdBy);
  if (filters.createdByIds?.length)
    query = query.in("created_by", filters.createdByIds);
  if (filters.phone) query = query.eq("phone", filters.phone);
  if (filters.otherPhone) query = query.eq("other_phone", filters.otherPhone);
  return query;
}

function applyAmountFilters(query: any, filters: Filters) {
  if (filters.amountMin !== undefined)
    query = query.gte("amount", filters.amountMin);
  if (filters.amountMax !== undefined)
    query = query.lte("amount", filters.amountMax);
  if (filters.amountExact !== undefined)
    query = query.eq("amount", filters.amountExact);
  return query;
}

function applyStatusFilters(query: any, filters: Filters) {
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.statuses?.length) query = query.in("status", filters.statuses);

  // Installment filters
  if (filters.isInstallment !== undefined && filters.isInstallment !== null) {
    const boolVal = filters.isInstallment === true || (filters.isInstallment as any) === "true";
    query = query.eq("is_installment", boolVal);
  }
  if (filters.paymentModelId) query = query.eq("payment_model_id", filters.paymentModelId);
  
  // Archive filter - default to hiding archived sales
  if (filters.showArchived === true || (filters.showArchived as any) === "true") {
    query = query.eq("is_archived", true);
  } else {
    query = query.eq("is_archived", false);
  }

  return query;
}

// UUID that matches no row — used to return an empty result set for scoped
// callers with nothing assigned, instead of silently widening their scope.
const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

function applyOrganizationFilters(
  query: any,
  filters: Filters,
  userRole: string,
  userOrgId: string | null,
  assignedOrgIds?: string[],
  userId?: string,
  teamAgentIds?: string[]
) {
  console.log("🏢 Applying organization filters...");

  if (userRole === "super_admin") {
    // Super admin: all sales, optional org filtering
    console.log("👑 Super admin: optional org filtering");
    if (filters.organizationId) {
      query = query.eq("organization_id", filters.organizationId);
    } else if (filters.organizationIds?.length) {
      query = query.in("organization_id", filters.organizationIds);
    }
  } else if (
    userRole === "acsl_agent" ||
    userRole === "acsl_agent_manager" ||
    userRole === "super_admin_agent"
  ) {
    // ACSL roles: assigned partner sales only. Client-supplied org filters are
    // honored only within the assigned scope (intersection), never beyond it.
    console.log(`🔗 ${userRole}: scoped to ${assignedOrgIds?.length || 0} assigned orgs`);
    const scope = assignedOrgIds || [];
    const team = userRole === "acsl_agent_manager" ? teamAgentIds || [] : [];
    if (filters.organizationId) {
      query = scope.includes(filters.organizationId)
        ? query.eq("organization_id", filters.organizationId)
        : query.eq("organization_id", NO_MATCH_ID);
    } else if (filters.organizationIds?.length) {
      const allowed = filters.organizationIds.filter((id) => scope.includes(id));
      query = allowed.length
        ? query.in("organization_id", allowed)
        : query.eq("organization_id", NO_MATCH_ID);
    } else if (team.length > 0) {
      // Manager: every org formally assigned to the team, PLUS any sale
      // attributed to a team member — a subordinate can record a sale for a
      // partner that's only assigned to them, not the manager, and the manager
      // must still see it. Attribution matches EITHER sold_on_behalf_of OR
      // created_by, because sold_on_behalf_of is NULL on older rows where only
      // the creator was stamped.
      const teamList = team.join(",");
      const teamClause = `sold_on_behalf_of.in.(${teamList}),created_by.in.(${teamList})`;
      query = scope.length
        ? query.or(`organization_id.in.(${scope.join(",")}),${teamClause}`)
        : query.or(teamClause);
    } else if (scope.length === 0) {
      query = query.eq("organization_id", NO_MATCH_ID);
    } else {
      query = query.in("organization_id", scope);
    }
  } else if (userRole === "partner" || userRole === "admin") {
    // Partner: own organization's sales only. Client org filters cannot widen this.
    console.log("🏢 Partner: locked to own organization");
    query = query.eq("organization_id", userOrgId || NO_MATCH_ID);
  } else {
    // partner_agent / agent: own sales only, regardless of org or client filters.
    // A sale belongs to the agent if they created it or it was sold on their behalf.
    console.log("👤 Partner agent: own sales only");
    if (userId) {
      query = query.or(`created_by.eq.${userId},sold_on_behalf_of.eq.${userId}`);
    } else {
      query = query.eq("organization_id", NO_MATCH_ID);
    }
  }

  return query;
}

function applyBooleanFilters(query: any, filters: Filters) {
  if (filters.hasStoveImage !== undefined) {
    if (filters.hasStoveImage) {
      query = query.not("stove_image_id", "is", null);
    } else {
      query = query.is("stove_image_id", null);
    }
  }
  if (filters.hasAgreementImage !== undefined) {
    if (filters.hasAgreementImage) {
      query = query.not("agreement_image_id", "is", null);
    } else {
      query = query.is("agreement_image_id", null);
    }
  }
  if (filters.hasSignature !== undefined) {
    if (filters.hasSignature) {
      query = query.not("signature", "is", null);
    } else {
      query = query.is("signature", null);
    }
  }
  return query;
}

function applySearchFilter(query: any, filters: Filters) {
  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    query = query.or(
      `contact_person.ilike.${searchTerm},end_user_name.ilike.${searchTerm},aka.ilike.${searchTerm},phone.ilike.${searchTerm},other_phone.ilike.${searchTerm},stove_serial_no.ilike.${searchTerm},partner_name.ilike.${searchTerm},contact_phone.ilike.${searchTerm}`
    );
  }
  return query;
}

function applySorting(query: any, filters: Filters) {
  console.log("🔄 Applying sorting...");

  const sortBy = filters.sortBy || "created_at";
  const sortOrder = filters.sortOrder || "desc";

  if (filters.multiSort?.length) {
    filters.multiSort.forEach((sort) => {
      query = query.order(sort.field, { ascending: sort.order === "asc" });
    });
  } else {
    query = query.order(sortBy, { ascending: sortOrder === "asc" });
  }

  return query;
}

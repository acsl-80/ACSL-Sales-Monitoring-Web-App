// Filter parsing module

export interface Filters {
  // Include flags
  includeOrganization?: boolean;
  includeAddress?: boolean;
  includeCreator?: boolean;
  includeImages?: boolean;
  includeStoveImage?: boolean;
  includeAgreementImage?: boolean;
  includeSalesHistory?: boolean;

  // Pagination
  limit?: number;
  offset?: number;
  page?: number;

  // Sorting
  sortBy?: string;
  sortOrder?: string;
  multiSort?: Array<{ field: string; order: string }>;

  // Date filters
  dateFrom?: string;
  dateTo?: string;
  createdFrom?: string;
  createdTo?: string;
  lastNDays?: number;
  thisWeek?: boolean;
  thisMonth?: boolean;
  thisYear?: boolean;

  // Location filters
  state?: string;
  states?: string[];
  lga?: string;
  lgas?: string[];

  // Stove filters
  stoveSerialNo?: string;
  stoveSerialNos?: string[];
  stoveSerialNoPattern?: string;

  // People filters
  contactPerson?: string;
  contactPhone?: string;
  endUserName?: string;
  aka?: string;
  partnerName?: string;
  createdBy?: string;
  createdByIds?: string[];

  // Amount filters
  amountMin?: number;
  amountMax?: number;
  amountExact?: number;

  // Status filters
  status?: string;
  statuses?: string[];

  // Organization filters
  organizationId?: string;
  organizationIds?: string[];

  // Phone filters
  phone?: string;
  otherPhone?: string;

  // Boolean filters
  hasStoveImage?: boolean;
  hasAgreementImage?: boolean;
  hasSignature?: boolean;

  // Installment filters
  isInstallment?: boolean;
  paymentStatus?: string;
  paymentModelId?: string;

  // Search
  search?: string;

  // Archive
  showArchived?: boolean;

  // Export
  export?: string;
  exportFields?: string[];

  // Response format
  responseFormat?: string;
}

export async function parseFilters(req: Request): Promise<Filters> {
  console.log("📋 Parsing request filters...");

  const filters: Filters =
    req.method === "POST"
      ? await req.json()
      : Object.fromEntries(new URL(req.url).searchParams.entries());

  console.log("✅ Raw filters parsed:", Object.keys(filters).length, "keys");
  console.log("📊 Filter summary:", {
    includes:
      [
        filters.includeOrganization && "org",
        filters.includeAddress && "addr",
        filters.includeCreator && "creator",
        filters.includeImages && "images",
      ]
        .filter(Boolean)
        .join(", ") || "none",
    limit: filters.limit || "default",
    search: filters.search ? "yes" : "no",
    export: filters.export || "no",
    responseFormat: filters.responseFormat || "format1 (default)",
  });

  return filters;
}

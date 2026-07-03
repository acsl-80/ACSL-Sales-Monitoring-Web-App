export interface SalesFilters {
  // Date filters
  dateFrom?: string;
  dateTo?: string;
  createdFrom?: string;
  createdTo?: string;
  salesDateFrom?: string;
  salesDateTo?: string; // Additional fields that might be used
  signature_url?: string;
  receipt_url?: string;
  attachments?: Array<{ name?: string; url: string }>;
  longitude?: number;
  latitude?: number;

  // Legacy fields for backward compatibility
  address?: Address;
  organization?: Organization;
  organization_name?: string;
  ring: any;

  // Location filters
  state?: string;
  states?: string[];
  city?: string;
  cities?: string[];
  lga?: string;
  lgas?: string[];
  country?: string;

  // Product/Stove filters
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
  amountRange?: { min: number; max: number };

  // Status filters
  status?: string;
  statuses?: string[];

  // Organization filters
  organizationId?: string;
  organizationIds?: string[];

  // Phone filters
  phone?: string;
  otherPhone?: string;
  anyPhone?: string;

  // Text search filters
  search?: string;
  searchFields?: string[];

  // Advanced filters
  hasStoveImage?: boolean;
  hasAgreementImage?: boolean;
  hasSignature?: boolean;
  hasAddress?: boolean;

  // Geolocation filters
  nearLocation?: {
    latitude: number;
    longitude: number;
    radiusKm: number;
  };

  // Pagination
  page?: number;
  limit?: number;
  offset?: number;

  // Sorting
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  multiSort?: Array<{ field: string; order: "asc" | "desc" }>;

  // Export options
  export?: "csv" | "json" | "xlsx";
  exportFields?: string[];

  // Data inclusion options
  includeAddress?: boolean;
  includeImages?: boolean;
  includeCreator?: boolean;
  includeOrganization?: boolean;
  includeSalesHistory?: boolean;

  // Time-based filters
  lastNDays?: number;
  thisWeek?: boolean;
  thisMonth?: boolean;
  thisYear?: boolean;
  lastWeek?: boolean;
  lastMonth?: boolean;
  lastYear?: boolean;

  // Advanced date queries
  dayOfWeek?: number;
  monthOfYear?: number;
  quarter?: number;
}

export interface Address {
  id: string;
  city?: string;
  state?: string;
  street?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  full_address?: string;
  created_at?: string;
}

export interface ImageData {
  id: string;
  url?: string;
  type?: string;
  public_id?: string;
  created_at?: string;
}

export interface UserProfile {
  id: string;
  full_name?: string;
  email?: string;
  phone?: string;
  role?: string;
}

export interface Organization {
  id: string;
  name?: string;
  partner_email?: string;
  type?: string;
  address?: string;
  contact_info?: any;
}

export interface SalesHistory {
  id: string;
  action_type?: string;
  action_description?: string;
  field_changes?: any;
  performed_at?: string;
  performed_by?: string;
}

export interface SuperAdminSale {
  id: string;
  transaction_id?: string;
  stove_serial_no?: string;
  sales_date?: string;
  contact_person?: string;
  contact_phone?: string;
  end_user_name?: string;
  aka?: string;
  state_backup?: string;
  lga_backup?: string;
  phone?: string;
  other_phone?: string;
  partner_name?: string;
  amount: number;
  signature?: string;
  status?: string;
  created_by?: string;
  organization_id?: string;
  address_id?: string;
  stove_image_id?: string;
  agreement_image_id?: string;
  created_at?: string;

  // Installment payment fields
  is_installment?: boolean;
  payment_model_id?: string;
  total_paid?: number;
  payment_status?: string;
  payment_model?: {
    id: string;
    name: string;
    duration_months: number;
    fixed_price: number;
  };

  // New fields from user agreement form
  retailer_branch?: string;
  pot_quantity?: number | null;
  heat_retention_device?: boolean;
  previous_stove_type?: string;
  previous_stove_other?: string;
  meals_per_day?: string;
  cooking_fuel_source?: string;
  cooking_location?: string;
  terms_accepted?: {
    poaGoverned?: boolean;
    monitoring?: boolean;
    noResell?: boolean;
    emissionReductions?: boolean;
    noExport?: boolean;
    demonstration?: boolean;
  } | null;

  // Related data (when included) - Updated to match new response structure
  addresses?: Address; // Changed from address to addresses
  stove_image?: ImageData;
  agreement_image?: ImageData;
  creator?: UserProfile;
  organizations?: Organization; // Changed from organization to organizations
  profiles?: UserProfile; // Added profiles
  sales_history?: SalesHistory[];

  // // Legacy fields for backward compatibility
  // addresses?: Address;
  // organization?: Organization;
  // organization_name?: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
}

export interface SalesResponse {
  success: boolean;
  data?: SuperAdminSale[];
  pagination?: PaginationInfo;
  filters?: SalesFilters;
  timestamp?: string;
  message?: string;
  error?: string;
}

// Status types for better type safety
export type SaleStatus =
  | "active"
  | "pending"
  | "completed"
  | "cancelled"
  | "inactive";

// Export format types
export type ExportFormat = "csv" | "json" | "xlsx";

// Sort order types
export type SortOrder = "asc" | "desc";

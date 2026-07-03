export interface Organization {
  id: string;
  partner_name: string; // Required - Partner name
  branch: string; // Required - Branch
  state: string; // Required - State
  contact_person?: string; // Optional - Contact person
  contact_phone?: string; // Optional - Contact phone number
  alternative_phone?: string; // Optional - Alternative phone number
  email?: string; // Optional - Email
  address?: string; // Optional - Address
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

export interface OrganizationFilters {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
}

export interface OrganizationStats {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  recentlyCreated: number;
}

export interface CreateOrganizationData {
  partner_name: string; // Required
  branch: string; // Required
  state: string; // Required
  contact_person?: string; // Optional
  contact_phone?: string; // Optional
  alternative_phone?: string; // Optional
  email?: string; // Optional
  address?: string; // Optional
}

export interface UpdateOrganizationData {
  partner_name?: string;
  branch?: string;
  state?: string;
  contact_person?: string;
  contact_phone?: string;
  alternative_phone?: string;
  email?: string;
  address?: string;
}

// CSV Import types
export interface CSVRowData {
  "Sales Reference": string;
  "Sales Date": string;
  Customer: string;
  State: string;
  Branch: string;
  Quantity: string;
  "Downloaded by": string;
  "Stove IDs": string;
  "Sales Factory": string;
  "Sales Rep": string;
  "Partner ID": string;
  "Partner Address": string;
  "Partner Contact Person": string;
  "Partner Contact Phone": string;
  "Partner Alternative Phone": string;
  "Partner Email": string;
}

export interface CSVImportResult {
  success: boolean;
  message: string;
  data: {
    created: Array<{
      action: "created";
      organization: Organization;
      admin_user?: any;
      partner_id: string;
    }>;
    updated: Array<{
      action: "updated";
      organization: Organization;
      partner_id: string;
    }>;
    errors: Array<{
      partner_id?: string;
      error: string;
      type: string;
    }>;
    summary: {
      total_rows: number;
      organizations_created: number;
      organizations_updated: number;
      errors_count: number;
    };
  };
  timestamp: string;
  performance: {
    response_time_ms: number;
  };
}

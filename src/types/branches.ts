export interface Branch {
  id: string;
  organization_id: string;
  name: string;
  country: string;
  state?: string;
  lga?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  organizations?: {
    id: string;
    partner_name: string;
    email: string;
    branch?: string;
    state?: string;
    address?: string;
    contact_person?: string;
    phone?: string;
    alternative_phone?: string;
  };
  profiles?: {
    id: string;
    full_name: string;
    email: string;
  };
}

export interface BranchFilters {
  page?: number;
  limit?: number;
  search?: string;
  country?: string;
  state?: string;
  organization_id?: string;
}

export interface CreateBranchData {
  name: string;
  country?: string;
  state?: string;
  lga?: string;
}

export interface UpdateBranchData {
  name?: string;
  country?: string;
  state?: string;
  lga?: string;
}

export interface BranchResponse {
  success: boolean;
  message: string;
  data: {
    branch: Branch;
  };
}

export interface BranchesResponse {
  success: boolean;
  message: string;
  data: {
    branches: Branch[];
    organization?: {
      id: string;
      partner_name: string;
      email: string;
      branch?: string;
      state?: string;
      address?: string;
      contact_person?: string;
      phone?: string;
      alternative_phone?: string;
    };
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
}

export interface BranchStats {
  total: number;
  byCountry: Record<string, number>;
  byState: Record<string, number>;
  recentlyCreated: number;
}

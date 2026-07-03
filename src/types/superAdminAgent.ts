// ACSL Agent types (formerly SuperAdminAgent)

export interface AcslAgent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: "acsl_agent";
  status: string;
  organization_id: null; // ACSL Agent users never own an organization
  created_at: string;
  assigned_organizations_count?: number;
  assigned_organizations?: AssignedOrganization[];
}

// Backward compat alias
export type SuperAdminAgent = AcslAgent;

export interface AssignedOrganization {
  id: string;
  partner_name: string;
  branch: string | null;
  state: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  email?: string | null;
  assignment_id: string;
  assigned_at: string;
  assigned_by?: string;
}

export interface AcslAgentDashboardStats {
  assignedPartnersCount: number;
  totalSales: number;
  pendingApprovals: number;
  approvedSales: number;
  salesCreatedByMe: number;
}

// Backward compat alias
export type SuperAdminAgentDashboardStats = AcslAgentDashboardStats;

export interface CreateAcslAgentPayload {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
}

// Backward compat alias
export type CreateSuperAdminAgentPayload = CreateAcslAgentPayload;

export interface UpdateAcslAgentPayload {
  full_name?: string;
  phone?: string;
  status?: "active" | "disabled";
}

// Backward compat alias
export type UpdateSuperAdminAgentPayload = UpdateAcslAgentPayload;

export interface SetAgentOrganizationsPayload {
  organization_ids: string[];
}

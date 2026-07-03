export interface SalesAgent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  organization_id: string;
  created_at: string;
  has_changed_password?: boolean; // Optional since it might not always be included in the response
  total_sold?: number;
  last_login?: string | null;
}

export interface SalesAgentResponse {
  success: boolean;
  data: SalesAgent[];
  message: string;
  userRole: string;
  userOrganization: string;
}

export interface CreateAgentRequest {
  name: string;
  email: string;
  password: string;
  phone: string;
}

export interface CreateAgentResponse {
  success: boolean;
  data: {
    generatedPassword: string;
    agent: SalesAgent;
  };
  error?: string;
}

export interface AgentCredentials {
  name: string;
  email: string;
  password: string;
}

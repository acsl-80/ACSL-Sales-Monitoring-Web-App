/* eslint-disable no-undef */
// ACSL Agent Service (formerly Super Admin Agent Service)
// Handles all API calls for acsl_agent user management and their portal operations
import tokenManager from "../../utils/tokenManager";
import { supabaseUrl } from "../../lib/supabaseConfig";

const API_BASE_URL = supabaseUrl;
const API_FUNCTIONS_URL = `${API_BASE_URL}/functions/v1`;


class SuperAdminAgentService {
  // Get a valid auth token
  async getToken() {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("🤝 [SuperAdminAgentService] Token error:", error);
      return null;
    }
  }

  // Build request headers
  async getHeaders() {
    const token = await this.getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  // Helper: make a fetch call and parse response
  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: await this.getHeaders(),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    if (!result.success) {
      throw new Error(result.message || "Request failed");
    }

    return result;
  }

  // ─── Super Admin: Manage SAA Users ────────────────────────────────────────

  // KPI stats for the agents manager dashboard
  async getAgentKpiStats({ dateFrom, dateTo } = {}) {
    const qs = new URLSearchParams();
    if (dateFrom) qs.append("date_from", dateFrom);
    if (dateTo) qs.append("date_to", dateTo);
    const url = `${API_FUNCTIONS_URL}/super-admin-agents/kpi-stats${qs.toString() ? "?" + qs.toString() : ""}`;
    return await this.request(url, { method: "GET" });
  }

  // List all super admin agents (pass organization_id to filter by org assignment)
  async getSuperAdminAgents(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") qs.append(k, String(v));
    });
    const url = `${API_FUNCTIONS_URL}/super-admin-agents${qs.toString() ? "?" + qs.toString() : ""}`;
    return await this.request(url, { method: "GET" });
  }


  // Get a single super admin agent by ID
  async getSuperAdminAgent(agentId) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}`,
      { method: "GET" }
    );
  }

  // Create a new super admin agent
  async createSuperAdminAgent(data) {
    return await this.request(`${API_FUNCTIONS_URL}/super-admin-agents`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Update a super admin agent
  async updateSuperAdminAgent(agentId, data) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}`,
      { method: "PATCH", body: JSON.stringify(data) }
    );
  }

  // Delete a super admin agent
  async deleteSuperAdminAgent(agentId) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}`,
      { method: "DELETE" }
    );
  }

  // ─── Organization Assignments ──────────────────────────────────────────────

  // Get assigned organizations for an agent
  async getAgentOrganizations(agentId, { dateFrom, dateTo } = {}) {
    const qs = new URLSearchParams();
    if (dateFrom) qs.append("date_from", dateFrom);
    if (dateTo) qs.append("date_to", dateTo);
    const url = `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/organizations${qs.toString() ? "?" + qs.toString() : ""}`;
    return await this.request(url, { method: "GET" });
  }

  // Replace all org assignments for an agent (full replace)
  async setAgentOrganizations(agentId, organizationIds) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/organizations`,
      { method: "POST", body: JSON.stringify({ organization_ids: organizationIds }) }
    );
  }

  // Remove a single org assignment
  async removeAgentOrganization(agentId, orgId) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/organizations/${orgId}`,
      { method: "DELETE" }
    );
  }

  // ─── Coverage scope (mode + states + partners + exclusions) ───────────────

  /**
   * The whole coverage configuration for an agent.
   *
   * Returns null when the endpoint is not deployed yet, rather than throwing.
   * Migrations apply to production on merge but edge functions do not, so
   * there is a window where the new UI is live and this route is not. The
   * modal probes with this and falls back to the old two-endpoint path, which
   * means neither deploy has to wait for the other.
   */
  async getAgentScope(agentId) {
    try {
      return await this.request(
        `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/scope`,
        { method: "GET" }
      );
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (msg.includes("404") || msg.toLowerCase().includes("route not found")) return null;
      throw e;
    }
  }

  /**
   * Replace the whole configuration in one call.
   *
   * All four keys are always sent. The server refuses a missing array rather
   * than treating it as empty, because the endpoints this replaces defaulted
   * them to [] and a malformed request silently cleared every assignment an
   * agent had.
   */
  async setAgentScope(agentId, { mode, states, organizationIds, excludedOrganizationIds }) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/scope`,
      {
        method: "PUT",
        body: JSON.stringify({
          mode: mode ?? null,
          states: states ?? [],
          organization_ids: organizationIds ?? [],
          excluded_organization_ids: excludedOrganizationIds ?? [],
        }),
      }
    );
  }

  // ─── State Assignments ────────────────────────────────────────────────────

  // Get assigned states for an agent
  // Several agents' scopes in one call: states, organisations, exclusions and
  // mode per agent, plus the direct assignment rows when asked.
  async getAgentScopes(agentIds, { withAssignments = false } = {}) {
    const ids = [...new Set((agentIds || []).filter(Boolean))];
    if (ids.length === 0) return { data: {} };
    const qs = new URLSearchParams({ ids: ids.join(",") });
    if (withAssignments) qs.append("with_assignments", "true");
    return await this.request(`${API_FUNCTIONS_URL}/super-admin-agents/scopes?${qs}`, { method: "GET" });
  }
  async getAgentStates(agentId) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/states`,
      { method: "GET" }
    );
  }

  // Replace all state assignments for an agent (full replace)
  async setAgentStates(agentId, states) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/states`,
      { method: "POST", body: JSON.stringify({ states }) }
    );
  }

  // Remove a single state assignment
  async removeAgentState(agentId, state) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agents/${agentId}/states/${encodeURIComponent(state)}`,
      { method: "DELETE" }
    );
  }

  // ─── SAA Portal: Dashboard ────────────────────────────────────────────────

  // Get dashboard stats for the logged-in SAA
  async getDashboardStats({ year, date_from, date_to } = {}) {
    return await this.request(
      `${API_FUNCTIONS_URL}/super-admin-agent-dashboard`,
      {
        method: "POST",
        headers: await this.getHeaders(),
        body: JSON.stringify({
          year: (!date_from && !date_to) ? (year ?? new Date().getFullYear()) : undefined,
          date_from: date_from || undefined,
          date_to: date_to || undefined,
        }),
      }
    );
  }

  // Get stove IDs across all orgs managed by this agent
  async getAgentStoveIds({ status, limit = 500, offset = 0 } = {}) {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${API_FUNCTIONS_URL}/get-agent-stove-ids`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(status ? { status } : {}),
          limit,
          offset,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${response.status}`);
      }
      const result = await response.json();
      if (!result.success) throw new Error(result.message || "Failed to fetch stove IDs");
      return { success: true, data: result.data, pagination: result.pagination, totals: result.totals };
    } catch (error) {
      console.error("getAgentStoveIds error:", error);
      return { success: false, data: [], error: error.message };
    }
  }

  // ─── SAA Portal: Sales ────────────────────────────────────────────────────

  // Approve a sale (SAA marks it as verified)
  async approveSale(saleId) {
    return await this.request(
      `${API_FUNCTIONS_URL}/approve-sale/${saleId}`,
      { method: "PATCH" }
    );
  }
}

// Export singleton instance
const acslAgentService = new SuperAdminAgentService();
// Backward compat alias
const superAdminAgentService = acslAgentService;
export { acslAgentService };
export default superAdminAgentService;

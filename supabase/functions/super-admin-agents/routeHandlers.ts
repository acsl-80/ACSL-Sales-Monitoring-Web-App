// Route handler — parses URL path and dispatches to operation files

import { listAgents, getAgent, getAgentOrganizations } from "./readOptions.ts";
import { createAgent, updateAgent } from "./writeOptions.ts";
import { deleteAgent } from "./deleteOptions.ts";
import { setAgentOrganizations, removeAgentOrganization } from "./organizationOptions.ts";
import { getAgentStates, setAgentStates, removeAgentState } from "./stateOptions.ts";
import { authenticateSuperAdmin, authenticateReadAccess, authenticateManagerOrAdmin } from "./authenticate.ts";
import { getKpiStats } from "./kpiStats.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

export async function handleRoute(req: Request, supabase: any) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // Parse path parts after the function name
  // Expected patterns:
  //   /super-admin-agents
  //   /super-admin-agents/{agentId}
  //   /super-admin-agents/{agentId}/organizations
  //   /super-admin-agents/{agentId}/organizations/{orgId}
  //   /super-admin-agents/{agentId}/states
  //   /super-admin-agents/{agentId}/states/{state}
  const pathParts = url.pathname.split("/").filter(Boolean);
  const fnIndex = pathParts.findIndex((p) => p === "super-admin-agents");
  const relative = fnIndex >= 0 ? pathParts.slice(fnIndex + 1) : pathParts;

  const agentId = relative[0] || null;
  const subResource = relative[1] || null; // "organizations" | "states"
  const subResourceId = relative[2] || null; // orgId or state name

  const authHeader = req.headers.get("Authorization") ?? "";

  // ── GET /super-admin-agents/kpi-stats
  if (method === "GET" && agentId === "kpi-stats" && !subResource) {
    await authenticateManagerOrAdmin(supabase, authHeader);
    return await getKpiStats(supabase, url.searchParams);
  }

  // ── GET /super-admin-agents  (list)
  if (method === "GET" && !agentId) {
    const auth = await authenticateReadAccess(supabase, authHeader);
    if (["acsl_agent", "super_admin_agent"].includes(auth.userRole)) {
      // Plain ACSL agents may only list agents for a single organization
      // within their assigned scope (Performance Report → Partners tab
      // shows which agents serve each of their assigned partners).
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) {
        throw new Error("Unauthorized: organization_id is required for this role");
      }
      const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, auth.userId);
      if (!assignedOrgIds.includes(organizationId)) {
        throw new Error("Unauthorized: organization is not in your assigned scope");
      }
      return await listAgents(supabase, url.searchParams, null);
    }
    // acsl_agent_manager only sees agents they created (manager_id = their ID)
    const managerFilter = auth.userRole === "acsl_agent_manager" ? auth.userId : null;
    return await listAgents(supabase, url.searchParams, managerFilter);
  }

  // ── GET /super-admin-agents/{id}/organizations
  if (method === "GET" && agentId && subResource === "organizations") {
    // Both super_admin and the SAA themselves can read
    const auth = await authenticateReadAccess(supabase, authHeader);
    // SAA can only read their own assignments
    if (["acsl_agent", "super_admin_agent"].includes(auth.userRole) && auth.userId !== agentId) {
      throw new Error("Unauthorized: You can only view your own assignments");
    }
    return await getAgentOrganizations(supabase, agentId, url.searchParams);
  }

  // ── GET /super-admin-agents/{id}/states
  if (method === "GET" && agentId && subResource === "states") {
    const auth = await authenticateReadAccess(supabase, authHeader);
    if (["acsl_agent", "super_admin_agent"].includes(auth.userRole) && auth.userId !== agentId) {
      throw new Error("Unauthorized: You can only view your own assignments");
    }
    return await getAgentStates(supabase, agentId);
  }

  // ── GET /super-admin-agents/{id}  (single agent)
  if (method === "GET" && agentId && !subResource) {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    return await getAgent(supabase, agentId);
  }

  // ── POST /super-admin-agents  (create)
  // Both super_admin and acsl_agent_manager can create acsl_agent accounts.
  // When a manager creates an agent, manager_id is auto-set to the manager's ID.
  if (method === "POST" && !agentId) {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    const body = await req.json();
    const managerId = auth.userRole === "acsl_agent_manager" ? auth.userId : null;
    return await createAgent(supabase, body, auth.userId, managerId);
  }

  // ── POST /super-admin-agents/{id}/organizations  (replace org assignments)
  if (method === "POST" && agentId && subResource === "organizations") {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    const body = await req.json();
    const orgIds: string[] = body.organization_ids ?? [];
    return await setAgentOrganizations(supabase, agentId, orgIds, auth.userId);
  }

  // ── POST /super-admin-agents/{id}/states  (replace state assignments)
  if (method === "POST" && agentId && subResource === "states") {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    const body = await req.json();
    const states: string[] = body.states ?? [];
    return await setAgentStates(supabase, agentId, states, auth.userId);
  }

  // ── PATCH /super-admin-agents/{id}  (update)
  if ((method === "PATCH" || method === "PUT") && agentId && !subResource) {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    const body = await req.json();
    return await updateAgent(supabase, agentId, body, auth.userId, auth.userRole === "acsl_agent_manager" ? auth.userId : null);
  }

  // ── DELETE /super-admin-agents/{id}/organizations/{orgId}
  if (method === "DELETE" && agentId && subResource === "organizations" && subResourceId) {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    return await removeAgentOrganization(supabase, agentId, subResourceId);
  }

  // ── DELETE /super-admin-agents/{id}/states/{state}
  if (method === "DELETE" && agentId && subResource === "states" && subResourceId) {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    return await removeAgentState(supabase, agentId, decodeURIComponent(subResourceId));
  }

  // ── DELETE /super-admin-agents/{id}
  if (method === "DELETE" && agentId && !subResource) {
    const auth = await authenticateManagerOrAdmin(supabase, authHeader);
    return await deleteAgent(supabase, agentId, auth.userId, auth.userRole === "acsl_agent_manager" ? auth.userId : null);
  }

  throw new Error(`Route not found: ${method} ${url.pathname}`);
}

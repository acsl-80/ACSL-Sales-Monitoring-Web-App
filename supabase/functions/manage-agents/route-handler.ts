// Route handler for agent operations

import { getAgent, getAgents } from "./read-operations.ts";
import { createAgent, updateAgent } from "./write-operations.ts";
import { deleteAgent } from "./delete-operations.ts";

export async function handleAgentRoute(
  req: Request,
  supabase: any,
  userId: string,
  userRole: string,
  organizationId: string | null
) {
  // Parse URL to get agent ID if present
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const agentId = pathParts[pathParts.length - 1];

  // Route to appropriate CRUD operation
  const method = req.method.toUpperCase();

  switch (method) {
    case "GET":
      if (agentId && agentId !== "manage-agents") {
        // Get single agent
        return await getAgent(supabase, agentId, userRole, organizationId);
      } else {
        // Get all agents with pagination
        return await getAgents(
          supabase,
          url.searchParams,
          userRole,
          organizationId
        );
      }

    case "POST":
      // Create new agent
      const createData = await req.json();
      return await createAgent(
        supabase,
        createData,
        userId,
        userRole,
        organizationId
      );

    case "PUT":
    case "PATCH":
      // Update agent
      if (!agentId || agentId === "manage-agents") {
        throw new Error("Agent ID is required for update operations");
      }
      const updateData = await req.json();
      return await updateAgent(
        supabase,
        agentId,
        updateData,
        userId,
        userRole,
        organizationId
      );

    case "DELETE":
      // Delete agent
      if (!agentId || agentId === "manage-agents") {
        throw new Error("Agent ID is required for delete operation");
      }
      return await deleteAgent(supabase, agentId, userRole, organizationId);

    default:
      throw new Error(`Method ${method} not allowed`);
  }
}

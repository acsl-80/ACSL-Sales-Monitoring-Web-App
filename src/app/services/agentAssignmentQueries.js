/**
 * Direct partner assignments, read from the browser.
 *
 * Slice 11c of the 2026-09-02 review (finding F31). This file used to probe
 * two assignment tables column by column for an agent id column, because it
 * did not trust the schema. The schema is known: the table is
 * acsl_agent_organizations, its column is agent_id, and
 * super_admin_agent_organizations is a view over it, so reading both counted
 * the same rows twice. These read the direct assignments only; a partner's
 * covering agents under state coverage come from the performance-report
 * function's partner-agents action.
 */

import { createClientComponentClient } from "@/lib/supabaseClient";

const supabase = createClientComponentClient();
// The view over acsl_agent_organizations, kept because it is what the browser
// role already has rights to read; it carries agent_id like the table.
const ASSIGNMENT_TABLE = "super_admin_agent_organizations";

/** The agents directly assigned to a partner. */
export async function getAgentIdsForPartner(orgId) {
  if (!orgId) return [];
  const { data, error } = await supabase.from(ASSIGNMENT_TABLE).select("agent_id").eq("organization_id", orgId);
  if (error || !data) return [];
  return Array.from(new Set(data.map((row) => row.agent_id).filter(Boolean)));
}

/** The partners directly assigned to an agent. */
export async function getPartnerIdsForAgent(agentId) {
  if (!agentId) return [];
  const { data, error } = await supabase.from(ASSIGNMENT_TABLE).select("organization_id").eq("agent_id", agentId);
  if (error || !data) return [];
  return Array.from(new Set(data.map((row) => row.organization_id).filter(Boolean)));
}

/** The partners directly assigned to an agent, with their names. */
export async function getPartnersForAgent(agentId) {
  const orgIds = await getPartnerIdsForAgent(agentId);
  if (orgIds.length === 0) return [];
  const { data, error } = await supabase
    .from("organizations")
    .select("id, partner_name, state, branch, partner_type")
    .in("id", orgIds)
    .order("partner_name", { ascending: true });
  if (error || !data) return [];
  return data;
}

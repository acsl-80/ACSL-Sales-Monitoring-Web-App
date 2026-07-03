// Single source of truth for ACSL agent ↔ partner assignment lookups.
// Used by BOTH the Agents Profile view and the Partner Profiles view so the
// two views can never disagree about who is assigned to whom.
//
// The assignments live in two tables (schemas differ across historical
// migrations):
//   - super_admin_agent_organizations  (canonical / current)
//   - acsl_agent_organizations         (legacy — still queried for old rows)
//
// The column that stores the agent id has drifted between deployments
// (`agent_id`, `super_admin_agent_id`, or `user_id`). Rather than pick one
// column and hope it's populated, we SELECT every candidate and use whichever
// one has a value for that row. This is symmetric across both directions and
// eliminates the previous bug where the Partner view would silently pick a
// column that existed but was empty and report 0 assigned agents.

import { createClientComponentClient } from "@/lib/supabaseClient";

const supabase = createClientComponentClient();

const AGENT_ID_CANDIDATES = ["agent_id", "super_admin_agent_id", "user_id"];
const ASSIGNMENT_TABLES = [
  "super_admin_agent_organizations",
  "acsl_agent_organizations",
];

// Per-table set of columns that actually exist. Resolved once per table.
const _existingCols = {};
async function getExistingAgentCols(table) {
  if (_existingCols[table]) return _existingCols[table];
  const found = [];
  for (const col of AGENT_ID_CANDIDATES) {
    const { error } = await supabase
      .from(table)
      .select(col, { count: "exact", head: true })
      .limit(1);
    if (!error) found.push(col);
  }
  _existingCols[table] = found;
  return found;
}

function pickAgentId(row, cols) {
  for (const c of cols) {
    if (row && row[c]) return row[c];
  }
  return null;
}

// ---- Partner → Agents ------------------------------------------------------
// Return the set of agent ids assigned to a given organization/partner,
// unioned across both assignment tables.
export async function getAgentIdsForPartner(orgId) {
  if (!orgId) return [];
  const ids = new Set();
  await Promise.all(
    ASSIGNMENT_TABLES.map(async (table) => {
      const cols = await getExistingAgentCols(table);
      if (cols.length === 0) return;
      const { data, error } = await supabase
        .from(table)
        .select(cols.join(","))
        .eq("organization_id", orgId);
      if (error || !data) return;
      data.forEach((row) => {
        const id = pickAgentId(row, cols);
        if (id) ids.add(id);
      });
    })
  );
  return Array.from(ids);
}

// ---- Agent → Partners ------------------------------------------------------
// Return the set of organization ids assigned to a given agent, unioned
// across both assignment tables. Uses the same column-agnostic strategy.
export async function getPartnerIdsForAgent(agentId) {
  if (!agentId) return [];
  const ids = new Set();
  await Promise.all(
    ASSIGNMENT_TABLES.map(async (table) => {
      const cols = await getExistingAgentCols(table);
      if (cols.length === 0) return;
      // OR across every existing candidate column so we catch rows regardless
      // of which column holds the agent id.
      const orExpr = cols.map((c) => `${c}.eq.${agentId}`).join(",");
      const { data, error } = await supabase
        .from(table)
        .select("organization_id")
        .or(orExpr);
      if (error || !data) return;
      data.forEach((row) => {
        if (row.organization_id) ids.add(row.organization_id);
      });
    })
  );
  return Array.from(ids);
}

// Full partner records (id, partner_name, state, branch) for an agent.
export async function getPartnersForAgent(agentId) {
  const orgIds = await getPartnerIdsForAgent(agentId);
  if (orgIds.length === 0) return [];
  const { data, error } = await supabase
    .from("organizations")
    .select("id, partner_name, state, branch")
    .in("id", orgIds);
  if (error) return [];
  return data || [];
}

// Full assignment rows for an agent (used by supervisor inference which needs
// `assigned_by`). Unions both tables and normalises the agent id column.
export async function getAssignmentRowsForAgent(agentId) {
  if (!agentId) return [];
  const rows = [];
  await Promise.all(
    ASSIGNMENT_TABLES.map(async (table) => {
      const cols = await getExistingAgentCols(table);
      if (cols.length === 0) return;
      const orExpr = cols.map((c) => `${c}.eq.${agentId}`).join(",");
      const { data, error } = await supabase
        .from(table)
        .select(
          `organization_id, assigned_by, ${cols.join(",")}, organizations(id, partner_name, state, branch)`
        )
        .or(orExpr);
      if (error || !data) return;
      data.forEach((r) => rows.push(r));
    })
  );
  return rows;
}

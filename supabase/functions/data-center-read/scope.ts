/**
 * Who may see which sales.
 *
 * The Data Center reads `public.sales`, so it must never show a user a row the
 * sales app would not. Rather than invent a rule, this mirrors `computeOrgPlan`
 * in supabase/functions/get-sales-advanced/build-query.ts, which is the sales
 * app's own authority on the question. If that file changes, this one has to
 * change with it.
 *
 * The one difference is form, not substance: get-sales-advanced expresses the
 * rule as PostgREST filter calls because it goes through PostgREST, while this
 * module holds an open Postgres connection and expresses it as a SQL fragment.
 * The table alias is passed in rather than hard-coded, so the caller composes
 * the fragment into its own query without rewriting the SQL text afterwards.
 *
 * Every branch fails closed. An unrecognised role, or a scope that resolves to
 * nothing, yields `false` and returns no rows. There is no branch that widens
 * to everything by accident.
 */

export interface ScopeInput {
  role: string | null;
  userId: string;
  organizationId: string | null;
  /** Resolved for ACSL roles only: direct + state-derived + subordinate orgs. */
  assignedOrgIds?: string[];
  /** Managers only: self plus subordinate acsl_agents. */
  teamAgentIds?: string[];
  /** Optional narrowing requested by the caller. Can never widen the scope. */
  requestedOrgId?: string | null;
}

export interface ScopeSql {
  /** SQL predicate over the caller's alias. Never empty. */
  sql: string;
  args: unknown[];
  /** For logging and for the response, so the UI can say what it is showing. */
  description: string;
}

/**
 * Builds the predicate. `nextArg` returns the placeholder for a value that the
 * caller appends to its own argument list, so this composes into a larger query
 * without assuming it starts at $1.
 */
export function buildScopeSql(
  input: ScopeInput,
  startIndex: number,
  alias: string,
): ScopeSql {
  const args: unknown[] = [];
  let i = startIndex;
  const p = (value: unknown) => {
    args.push(value);
    return `$${i++}`;
  };

  // Guarded rather than trusted: the alias is interpolated into SQL, so it is
  // restricted to a bare identifier even though every call site passes a
  // literal today.
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Invalid table alias: ${alias}`);
  }
  const a = `${alias}.`;

  const role = input.role;

  if (role === "super_admin") {
    if (input.requestedOrgId) {
      return {
        sql: `${a}organization_id = ${p(input.requestedOrgId)}`,
        args,
        description: "one organization",
      };
    }
    return { sql: "true", args, description: "all organizations" };
  }

  if (role === "acsl_agent" || role === "acsl_agent_manager" || role === "super_admin_agent") {
    const scope = input.assignedOrgIds ?? [];
    const team = role === "acsl_agent_manager" ? (input.teamAgentIds ?? []) : [];

    // A requested org is honoured only when it is already inside the scope.
    // Asking for one outside it returns nothing rather than everything.
    if (input.requestedOrgId) {
      if (!scope.includes(input.requestedOrgId)) {
        return { sql: "false", args, description: "organization not assigned" };
      }
      return {
        sql: `${a}organization_id = ${p(input.requestedOrgId)}`,
        args,
        description: "one assigned organization",
      };
    }

    const clauses: string[] = [];
    if (scope.length > 0) {
      clauses.push(`${a}organization_id = any(${p(scope)}::uuid[])`);
    }
    if (team.length > 0) {
      // A manager must also see sales their team recorded for an org only the
      // subordinate is assigned to. sold_on_behalf_of is null on older rows,
      // so created_by is checked too. Same reasoning as get-sales-advanced.
      const teamParam = p(team);
      clauses.push(
        `(${a}sold_on_behalf_of = any(${teamParam}::uuid[]) or ${a}created_by = any(${teamParam}::uuid[]))`,
      );
    }
    if (clauses.length === 0) {
      return { sql: "false", args, description: "no assigned organizations" };
    }
    return {
      sql: `(${clauses.join(" or ")})`,
      args,
      description:
        team.length > 0
          ? `${scope.length} assigned organizations plus team attribution`
          : `${scope.length} assigned organizations`,
    };
  }

  if (role === "partner" || role === "admin") {
    if (!input.organizationId) {
      return { sql: "false", args, description: "no organization on profile" };
    }
    return {
      sql: `${a}organization_id = ${p(input.organizationId)}`,
      args,
      description: "own organization",
    };
  }

  if (role === "partner_agent" || role === "agent") {
    const id = p(input.userId);
    return {
      sql: `(${a}created_by = ${id} or ${a}sold_on_behalf_of = ${id})`,
      args,
      description: "own sales",
    };
  }

  return { sql: "false", args, description: "role not permitted" };
}

/**
 * Who may see which transfers.
 *
 * A transfer is a fact about a partner, not about a sale, so the sale-level
 * rule above does not apply: `transfer_funnel` has an organization and nothing
 * else to scope by. This mirrors `get-transfer-history`, which is the sales
 * app's own authority on the same question, including the part where a
 * partner_agent gets nothing at all.
 *
 * That asymmetry is deliberate rather than an oversight. A partner agent may
 * see the sales they recorded; how many stoves ACSL shipped to their employer
 * is a different question and the sales app has already decided they do not
 * get to ask it.
 */
export function buildTransferScopeSql(
  input: ScopeInput,
  startIndex: number,
  alias: string,
): ScopeSql {
  const args: unknown[] = [];
  let i = startIndex;
  const p = (value: unknown) => {
    args.push(value);
    return `$${i++}`;
  };

  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Invalid table alias: ${alias}`);
  }
  const a = `${alias}.`;
  const role = input.role;

  if (role === "super_admin") {
    if (input.requestedOrgId) {
      return {
        sql: `${a}organization_id = ${p(input.requestedOrgId)}`,
        args,
        description: "one organization",
      };
    }
    return { sql: "true", args, description: "all organizations" };
  }

  if (role === "acsl_agent" || role === "acsl_agent_manager" || role === "super_admin_agent") {
    const scope = input.assignedOrgIds ?? [];
    if (input.requestedOrgId) {
      if (!scope.includes(input.requestedOrgId)) {
        return { sql: "false", args, description: "organization not assigned" };
      }
      return {
        sql: `${a}organization_id = ${p(input.requestedOrgId)}`,
        args,
        description: "one assigned organization",
      };
    }
    if (scope.length === 0) {
      return { sql: "false", args, description: "no assigned organizations" };
    }
    return {
      sql: `${a}organization_id = any(${p(scope)}::uuid[])`,
      args,
      description: `${scope.length} assigned organizations`,
    };
  }

  if (role === "partner" || role === "admin") {
    if (!input.organizationId) {
      return { sql: "false", args, description: "no organization on profile" };
    }
    return {
      sql: `${a}organization_id = ${p(input.organizationId)}`,
      args,
      description: "own organization",
    };
  }

  // partner_agent and agent, matching get-transfer-history's ALLOWED_ROLES.
  return { sql: "false", args, description: "role not permitted" };
}

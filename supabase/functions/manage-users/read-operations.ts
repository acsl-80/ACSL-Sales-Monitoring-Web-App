// Read operations for users

import {
  userInScope,
  scopeOrgList,
  managerNonOrgBranches,
  ORG_USER_ROLES,
  CallerContext,
  CallerScope,
} from "./scope.ts";
import { chunkArray, IN_CHUNK_SIZE } from "../_shared/chunkedQuery.ts";

export async function getUsers(
  supabase: any,
  searchParams: URLSearchParams,
  caller: CallerContext,
  scope: CallerScope
) {
  console.log("📋 Fetching users list...");

  try {
    // Parse pagination parameters
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 100);
    const offset = (page - 1) * limit;

    // Parse search and filter parameters
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const status = searchParams.get("status") || "";
    const sortBy = searchParams.get("sortBy") || "created_at";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    console.log("📊 Query parameters:", {
      page,
      limit,
      search,
      role,
      status,
      sortBy,
      sortOrder,
    });

    const ALL_ROLES = [
      "super_admin",
      "acsl_agent_manager",
      "acsl_agent",
      "partner_agent",
      "agent",
      "super_admin_agent",
    ];
    const ascending = sortOrder.toLowerCase() === "asc";

    // Base query factory: all filters EXCEPT row-level org scope + pagination.
    // A factory (not a single builder) is required because org scoping may be
    // applied across several chunked queries to avoid oversized request URLs.
    const buildBase = () => {
      // Partner organization profiles are managed in Partner views, not User
      // Management, so keep partner/admin rows out here.
      let q = supabase
        .from("profiles")
        .select("id, full_name, email, phone, role, status, created_at, last_login, organization_id, manager_id", {
          count: "exact",
        });

      if (role && ALL_ROLES.includes(role)) {
        q = q.eq("role", role);
      } else {
        q = q.in("role", ALL_ROLES);
      }
      q = q.not("role", "eq", "partner").not("role", "eq", "admin");

      if (status && ["active", "disabled"].includes(status)) {
        q = q.eq("status", status);
      }
      if (search.trim()) {
        q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
      }
      return q.order(sortBy, { ascending });
    };

    // Assemble the set of disjoint sub-queries ("thunks") that together produce
    // the scoped, filtered rows. Each thunk returns a builder WITHOUT range.
    const orgList = scopeOrgList(scope);
    const thunks: Array<() => any> = [];

    if (orgList === null) {
      // super_admin: no org-level scoping.
      thunks.push(() => buildBase());
    } else if (scope.type === "manager") {
      // Manager: subordinate ACSL agents + self (role-disjoint from org users)…
      thunks.push(() => buildBase().or(managerNonOrgBranches(caller.id).join(",")));
      // …plus org users of each assigned partner org, chunked.
      for (const c of chunkArray(orgList, IN_CHUNK_SIZE)) {
        thunks.push(() => buildBase().in("role", ORG_USER_ROLES).in("organization_id", c));
      }
    } else {
      // partner / acsl_agent: org users of scoped orgs only.
      if (orgList.length === 0) {
        // No assignments → deliberately match nothing.
        thunks.push(() => buildBase().eq("role", "__none__"));
      } else {
        for (const c of chunkArray(orgList, IN_CHUNK_SIZE)) {
          thunks.push(() => buildBase().in("role", ORG_USER_ROLES).in("organization_id", c));
        }
      }
    }

    // Sub-queries are disjoint by construction (distinct role sets / org sets),
    // so counts sum exactly. Each fetches its own top (offset+limit) rows; the
    // global page is a subset of their union, so we merge, sort, and slice.
    const top = offset + limit;
    const compare = (a: any, b: any) => {
      const av = a?.[sortBy], bv = b?.[sortBy];
      let c = av == null && bv == null ? 0 : av == null ? 1 : bv == null ? -1 : av < bv ? -1 : av > bv ? 1 : 0;
      if (!ascending) c = -c;
      if (c !== 0) return c;
      return a?.id < b?.id ? -1 : a?.id > b?.id ? 1 : 0;
    };

    const results = await Promise.all(thunks.map((t) => t().range(0, top - 1)));
    const usersError = results.find((r: any) => r.error)?.error;
    if (usersError) {
      console.error("❌ Error fetching users:", usersError);
      throw new Error(`Database error: ${usersError.message}`);
    }

    const seen = new Set<any>();
    const mergedUsers: any[] = [];
    let count = 0;
    for (const r of results) {
      count += r.count || 0;
      for (const row of r.data || []) {
        if (row?.id != null) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
        }
        mergedUsers.push(row);
      }
    }
    mergedUsers.sort(compare);
    const users = mergedUsers.slice(offset, offset + limit);

    // Batch-fetch organizations for partner_agent/agent rows
    const orgIds = Array.from(
      new Set(
        (users || [])
          .filter((u: any) =>
            ["partner_agent", "agent"].includes(u.role) && u.organization_id
          )
          .map((u: any) => u.organization_id)
      )
    );
    let orgMap = new Map<string, any>();
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, partner_name, state, branch")
        .in("id", orgIds);
      (orgs || []).forEach((o: any) => orgMap.set(o.id, o));
    }

    // Batch-fetch supervisor names for ACSL agent rows, so the frontend never
    // has to infer supervisors from other rows in the (possibly scoped) list.
    const managerIds = Array.from(
      new Set((users || []).map((u: any) => u.manager_id).filter(Boolean))
    );
    const managerMap = new Map<string, string>();
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", managerIds);
      (managers || []).forEach((m: any) => managerMap.set(m.id, m.full_name));
    }

    /*
     * The column-probing block that used to sit here is gone with the query it
     * fed. It fired six head requests on every listing to discover whether
     * agent_id, super_admin_agent_id or user_id existed on each of two
     * assignment names. Only agent_id has ever existed, and
     * super_admin_agent_organizations is a view over acsl_agent_organizations,
     * so it was probing one table twice for two columns that never shipped.
     */
    const ACSL_ROLES = new Set(["acsl_agent", "acsl_agent_manager", "super_admin_agent"]);

    // Fetch assigned_organizations_count + assigned_states_count for each SAA user
    const usersWithCounts = await Promise.all(
      (users || []).map(async (u: any) => {
        const user = {
          ...u,
          manager_name: u.manager_id ? managerMap.get(u.manager_id) ?? null : null,
        };
        if (ACSL_ROLES.has(user.role)) {
          /*
           * What this user actually covers, from the one definition of the
           * rule rather than from the assignment table.
           *
           * This used to union both assignment names across three candidate
           * agent-id columns, none of which is the effective answer: an agent
           * covered by state holds no named rows and showed 0 partners, while
           * an excluded partner still counted. It was also the one copy that
           * ran the rule backwards, deriving states FROM the named partners,
           * so a direct assignment added states where the resolver suppresses
           * them.
           */
          const { data: scopeRows, error: scopeError } = await supabase.rpc(
            "acsl_agent_org_scope",
            { p_agent_ids: [user.id] },
          );
          if (scopeError) {
            throw new Error(`Could not resolve coverage for ${user.id}: ${scopeError.message}`);
          }
          const orgIds = Array.from(
            new Set((scopeRows || []).map((r: any) => r.organization_id as string)),
          );

          const stateMap = new Map<string, string>();
          const addState = (raw: any) => {
            if (!raw) return;
            const s = String(raw).trim();
            if (!s) return;
            const key = s.toLowerCase();
            if (!stateMap.has(key)) stateMap.set(key, s);
          };

          /*
           * The states this user holds, not the states their partners happen
           * to sit in. Deriving one from the other is what made this disagree
           * with every other surface: an agent named against three partners in
           * two states was reported as holding two states they had never been
           * given.
           */
          const { data: heldStates } = await supabase
            .from("acsl_agent_states")
            .select("state")
            .eq("agent_id", user.id);
          (heldStates || []).forEach((r: any) => addState(r.state));

          const assigned_states = Array.from(stateMap.values());
          return {
            ...user,
            assigned_organizations_count: orgIds.length,
            assigned_states,
            assigned_states_count: assigned_states.length,
          };
        }

        if (["partner_agent", "agent"].includes(user.role)) {
          const org = user.organization_id ? orgMap.get(user.organization_id) : null;
          return {
            ...user,
            organization: org || null,
            assigned_organizations_count: org ? 1 : 0,
            assigned_states_count: org && org.state ? 1 : 0,
          };
        }
        return { ...user, assigned_organizations_count: 0, assigned_states_count: 0 };
      })
    );


    // Calculate pagination metadata
    const totalPages = Math.ceil((count || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    console.log(`✅ Found ${users?.length || 0} users (${count} total)`);

    return {
      message: `Found ${count || 0} users`,
      data: usersWithCounts,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: count || 0,
        itemsPerPage: limit,
        hasNextPage,
        hasPrevPage,
      },
      filters: {
        search,
        role,
        status,
        sortBy,
        sortOrder,
      },
    };
  } catch (error) {
    console.error("❌ Error in getUsers:", error);
    throw error;
  }
}

export async function getUser(
  supabase: any,
  userId: string,
  caller: CallerContext,
  scope: CallerScope
) {
  console.log("🔍 Fetching single user:", userId);

  try {
    // Query for single user by ID (any role)
    const { data: user, error: userError } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone, role, status, created_at, last_login, organization_id, manager_id")
      .eq("id", userId)
      .single();

    if (userError) {
      if (userError.code === "PGRST116") {
        throw new Error("User not found");
      }
      console.error("❌ Error fetching user:", userError);
      throw new Error(`Database error: ${userError.message}`);
    }

    if (!userInScope(scope, user, caller.id)) {
      throw new Error("User not found");
    }

    console.log("✅ User found:", user.id);

    return {
      message: "User retrieved successfully",
      data: user,
    };
  } catch (error) {
    console.error("❌ Error in getUser:", error);
    throw error;
  }
}

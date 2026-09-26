import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/**
 * Who is calling a function, and which organisations they may see.
 *
 * The scope rule lives in the database, in public.scope_organization_ids(),
 * the same function the row policies use. It is asked here with the caller's
 * own token, so a function and a table can never answer "may this person see
 * that organisation" differently.
 *
 * orgIds is null for a super admin (every organisation) and a list for anyone
 * else, possibly empty. The caller's token is read and verified explicitly:
 * getUser() on a client that only carries the header refuses valid sessions.
 */
export interface CallerScope {
  userId: string;
  role: string;
  organizationId: string | null;
  orgIds: string[] | null;
  /** Queries with the caller's rights: row policies apply. */
  userClient: any;
  /** Queries that bypass row policies; filter them by orgIds yourself. */
  serviceClient: any;
}

export class ScopeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const bearer = (req: Request) =>
  (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

/** True when the request carries the service role key: another server calling. */
export function isServiceCall(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return key.length > 0 && bearer(req) === key;
}

export async function callerScope(req: Request): Promise<CallerScope> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const token = bearer(req);
  if (!token) throw new ScopeError(401, "Sign in required");

  const serviceClient = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new ScopeError(401, "Sign in required");

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("role, status, organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Could not read the caller's profile: ${profileError.message}`);
  if (!profile || profile.status !== "active") throw new ScopeError(403, "Account is not active");

  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  let orgIds: string[] | null = null;
  if (profile.role !== "super_admin") {
    const { data, error } = await userClient.rpc("scope_organization_ids");
    if (error) throw new Error(`Could not resolve the caller's scope: ${error.message}`);
    orgIds = (data ?? [])
      .map((r: any) => (typeof r === "string" ? r : r?.scope_organization_ids))
      .filter((id: unknown): id is string => typeof id === "string");
  }

  return {
    userId: user.id,
    role: profile.role,
    organizationId: profile.organization_id ?? null,
    orgIds,
    userClient,
    serviceClient,
  };
}

/** May this caller see the given organisation? */
export function inScope(scope: CallerScope, organizationId: string | null | undefined): boolean {
  if (!organizationId) return scope.orgIds === null;
  return scope.orgIds === null || scope.orgIds.includes(organizationId);
}

/** Refuse unless the caller is a signed-in super admin or another server. */
export async function requireSuperAdminOrService(req: Request): Promise<void> {
  if (isServiceCall(req)) return;
  const scope = await callerScope(req);
  if (scope.role !== "super_admin") throw new ScopeError(403, "Super admins only");
}

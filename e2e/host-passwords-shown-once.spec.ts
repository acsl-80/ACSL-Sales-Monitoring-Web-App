import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction, getEdgeFunction } from "./helpers";

/**
 * Passwords are shown once and never stored.
 *
 * A new account's password is shown to whoever creates it, a forgotten one is
 * replaced with Reset and shown once, and nothing readable is kept in
 * public.credentials. The table itself is closed to signed-in users: every
 * reader and writer is an edge function running as the server.
 */

const TAG = "e2epwd";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const PARTNER_ROW = "e2e00000-0000-4000-8000-0000000000c1";

const made: string[] = [];

type Json = Record<string, unknown> & { data?: Record<string, unknown>; success?: boolean };

/** The same call as the app's, with a method: reset is a PUT. */
async function sendEdgeFunction(page: Page, method: string, path: string, body: Record<string, unknown>) {
  return page.evaluate(async ({ method, path, body }) => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
    const token = stored.access_token ?? stored?.currentSession?.access_token;
    const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
    const response = await fetch(`https://${ref}.supabase.co/functions/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { method, path, body });
}

async function createAgent(page: Page): Promise<{ id: string; email: string }> {
  const email = `${TAG}-${Date.now()}@preview.acsl.test`;
  const res = await callEdgeFunction(page, "super-admin-agents", {
    full_name: "Password Once",
    email,
    password: "Shown-once-123",
    role: "acsl_agent",
  });
  expect([200, 201], `create: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
  const id = ((res.body as Json).data?.id ?? "") as string;
  expect(id, "the new account's id").toBeTruthy();
  made.push(id);
  return { id, email };
}

async function storedPassword(userId: string): Promise<string | null | undefined> {
  const [row] = await branchSql<{ password: string | null }>(
    `select password from public.credentials where user_id = '${userId}'`,
  );
  return row?.password;
}

test.afterAll(async () => {
  await branchSql(`delete from public.credentials where id = '${PARTNER_ROW}'`).catch(() => {});
  for (const id of made) {
    await branchSql(`delete from public.credentials where user_id = '${id}'`).catch(() => {});
    await branchSql(`delete from public.profiles where id = '${id}'`).catch(() => {});
    await branchSql(`delete from auth.users where id = '${id}'`).catch(() => {});
  }
});

test("the credentials table is closed to signed-in users", async () => {
  const [row] = await branchSql<{ anon: boolean; authed: boolean; server: boolean }>(
    `select has_table_privilege('anon', 'public.credentials', 'SELECT') as anon,
            has_table_privilege('authenticated', 'public.credentials', 'SELECT') as authed,
            has_table_privilege('service_role', 'public.credentials', 'SELECT') as server`,
  );
  expect(row).toEqual({ anon: false, authed: false, server: true });
});

test("a new account's password is not stored, and the credential read returns none", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { id } = await createAgent(page);

  expect(await storedPassword(id), "nothing readable is kept").toBeNull();

  const read = await getEdgeFunction(page, `manage-credentials?user_id=${id}`);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  expect(Object.keys((read.body as Json).data ?? {}), "the read carries no password field").not.toContain("password");
});

test("reset shows the new password once, stores none, and asks for a change at sign-in", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { id } = await createAgent(page);
  await branchSql(`update public.profiles set has_changed_password = true where id = '${id}'`);

  const reset = await sendEdgeFunction(page, "PUT", "manage-credentials/reset-agent-password", {
    user_id: id,
    new_password: "Reset-once-456",
  });
  expect(reset.status, JSON.stringify(reset.body)).toBe(200);
  expect((reset.body as Json).data ?? reset.body, "the reply carries the new password once").toBeTruthy();
  expect(JSON.stringify(reset.body)).toContain("Reset-once-456");

  expect(await storedPassword(id), "and nothing readable is kept").toBeNull();
  const [profile] = await branchSql<{ changed: boolean | null }>(
    `select has_changed_password as changed from public.profiles where id = '${id}'`,
  );
  expect(profile?.changed, "the user picks their own password at next sign-in").toBe(false);
});

test("the credentials screens say the password is not stored", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { email } = await createAgent(page);
  const [org] = await branchSql<{ name: string; pid: string | null }>(
    `select partner_name as name, partner_id as pid from public.organizations where id = '${TWIN_A}'`,
  );
  await branchSql(
    `insert into public.credentials (id, partner_id, partner_name, email, username, password, organization_id, role, is_dummy_email)
     values ('${PARTNER_ROW}', 'E2EPWD', '${org.name.replace(/'/g, "''")}', 'e2epwd-partner@preview.acsl.test', 'e2epwd', null, '${TWIN_A}', 'admin', false)
     on conflict (id) do nothing`,
  );

  await page.goto("/settings/credentials");
  await expect(page.getByText("E2EPWD").first(), "the partner row is listed").toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Not stored · use Reset").first()).toBeVisible();
  await expect(page.getByText("•••").first(), "no masked password is drawn").toHaveCount(0);

  await page.getByRole("button", { name: /ACSL Agents/ }).click();
  await page.getByPlaceholder("Search by name or email...").fill(email);
  await expect(page.getByText(email).first(), "the new agent is listed").toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Not stored", { exact: true }).first()).toBeVisible();
});

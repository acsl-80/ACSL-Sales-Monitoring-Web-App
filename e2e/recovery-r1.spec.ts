/**
 * Recovery R1: the rig holds.
 *
 * Proves, on a preview with its own branch database and made-up accounts only:
 *   - the `recovery` schema cannot be reached from the browser, with the anon
 *     key or with a signed-in person's token;
 *   - a recovery-only (`recoverer`) account reads zero rows from every table in
 *     public, asked directly with its own token, and can open no sales page;
 *   - it can open /recovery, and sees only Recovery in the nav;
 *   - staff are let into Recovery per person, on top of their own role.
 *
 * That the sales app and the Data Center behave as before is proven by their
 * own suites (non-interference, host-pages-load, data-center-pages-load,
 * data-center), run unchanged against the same preview.
 *
 * The recoverer is created here, on the branch database, and removed after.
 * Its SQL twin is src/app/recovery/proof/r1-recoverer-reads-nothing.sql.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  BRANCH_REF,
  PRODUCTION_REF,
  PREVIEW_PASSWORD,
  USERS,
  branchSql,
  callEdgeFunction,
  primeBypass,
  signIn,
} from "./helpers";

const RECOVERER_ID = "c0000000-0000-4000-8000-0000000000e1";
const RECOVERER_EMAIL = "r1-recoverer@preview.acsl.test";
const SUPABASE = `https://${BRANCH_REF}.supabase.co`;

/**
 * Public reference data every signed-in account reads by design: places,
 * the sale form's field rules, payment models, app releases. Named here so a
 * new table that starts answering a recoverer fails this spec rather than
 * slipping in under a wildcard.
 */
const REFERENCE_TABLES = new Set([
  "nigeria_states",
  "nigeria_lgas",
  "sale_field_rules",
  "payment_models",
  "app_releases",
]);

/** Pages a recoverer may open. Everything else must turn them away. */
const OPEN_TO_RECOVERER = new Set(["/recovery/", "/profile/", "/login/", "/unauthorized/", "/download/"]);

async function createRecoverer() {
  await removeRecoverer();
  await branchSql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', '${RECOVERER_ID}', 'authenticated', 'authenticated',
      '${RECOVERER_EMAIL}', extensions.crypt('${PREVIEW_PASSWORD}', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"],"role":"recoverer"}'::jsonb,
      '{"full_name":"R1 Recoverer","role":"recoverer"}'::jsonb,
      false, '', '', '', '');
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), '${RECOVERER_ID}',
            jsonb_build_object('sub', '${RECOVERER_ID}', 'email', '${RECOVERER_EMAIL}', 'email_verified', true),
            'email', '${RECOVERER_ID}', now(), now(), now());
    update public.profiles set username = 'r1-recoverer', has_changed_password = true
     where id = '${RECOVERER_ID}';
  `);
  const [profile] = await branchSql<{ role: string; organization_id: string | null; status: string }>(
    `select role, organization_id, status from public.profiles where id = '${RECOVERER_ID}'`,
  );
  // Every assertion below means nothing unless this is a real recoverer.
  expect(profile).toEqual({ role: "recoverer", organization_id: null, status: "active" });
}

async function removeRecoverer() {
  await branchSql(`delete from recovery.module_access where user_id = '${RECOVERER_ID}'`).catch(() => {});
  await branchSql(`delete from auth.users where id = '${RECOVERER_ID}'`);
}

async function grantRecovery(email: string, level: string) {
  await branchSql(`
    insert into recovery.module_access (user_id, access_level)
    select id, '${level}' from public.profiles where email = '${email}'
    on conflict (user_id) do update set access_level = excluded.access_level`);
}

async function revokeRecovery(email: string) {
  await branchSql(`
    delete from recovery.module_access
     where user_id = (select id from public.profiles where email = '${email}')`);
}

/**
 * Sign in through the form and keep the anon key the app itself sends.
 *
 * Not the shared signIn helper: that one waits for /dashboard, and a
 * recoverer is turned away from /dashboard, which is part of what is proven.
 */
async function signInAsRecoverer(page: Page): Promise<{ token: string; anonKey: string }> {
  await guardProduction(page);
  let anonKey = "";
  page.on("request", (r) => {
    const key = r.headers()["apikey"];
    if (key && r.url().startsWith(SUPABASE)) anonKey = key;
  });
  await primeBypass(page);
  await page.goto("/login");
  await expect(page.locator('button[type="submit"]').first()).not.toHaveText(/redirecting/i, { timeout: 30_000 });
  await page.locator('input[type="text"]').first().fill(RECOVERER_EMAIL);
  await page.locator('input[type="password"]').first().fill(PREVIEW_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 40_000 });

  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    const stored = JSON.parse(localStorage.getItem(key ?? "") ?? "{}");
    return (stored.access_token ?? stored?.currentSession?.access_token ?? "") as string;
  });
  expect(token, "the recoverer has a session").not.toBe("");
  expect(anonKey, "the app sent its anon key").not.toBe("");
  return { token, anonKey };
}

/**
 * Never let a made-up login or a probe reach production, even if the preview
 * were wired to it by mistake. Installed before the first page load.
 */
async function guardProduction(page: Page) {
  await page.route(`https://${PRODUCTION_REF}.supabase.co/**`, (route) => route.abort("blockedbyclient"));
}

type Read =
  | { outcome: "rows"; rows: number }
  | { outcome: "refused" }
  | { outcome: "inconclusive"; detail: string };

/**
 * What one token can read from one relation.
 *
 * Only two answers count: a successful read with an exact count, or a
 * permission refusal from Postgres (42501). Anything else, a bad key, a server
 * error, a missing count, is inconclusive and fails the proof, because a
 * request that broke for another reason proves nothing about access.
 */
async function readAs(page: Page, relation: string, anonKey: string, bearer: string): Promise<Read> {
  const response = await page.request.get(`${SUPABASE}/rest/v1/${relation}?select=*&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${bearer}`, Prefer: "count=exact", "Accept-Profile": "public" },
  });
  if (response.ok()) {
    const total = Number((response.headers()["content-range"] ?? "").split("/")[1]);
    return Number.isFinite(total)
      ? { outcome: "rows", rows: total }
      : { outcome: "inconclusive", detail: `no exact count (${response.headers()["content-range"]})` };
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  if ((response.status() === 401 || response.status() === 403) && body.code === "42501") {
    return { outcome: "refused" };
  }
  return { outcome: "inconclusive", detail: `${response.status()} ${body.code ?? ""}`.trim() };
}

/** Whether PostgREST refused the recovery schema itself, which is the only acceptable answer. */
async function recoverySchemaRefused(page: Page, table: string, anonKey: string, bearer: string) {
  const response = await page.request.get(`${SUPABASE}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${bearer}`, "Accept-Profile": "recovery" },
  });
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  return { status: response.status(), code: body.code ?? null };
}

/** Read every relation of one kind as the recoverer; return what read rows and what was inconclusive. */
async function sweep(page: Page, relations: string[], anonKey: string, token: string, skip = new Set<string>()) {
  const reads: string[] = [];
  const inconclusive: string[] = [];
  for (const relation of relations) {
    if (skip.has(relation)) continue;
    const result = await readAs(page, relation, anonKey, token);
    if (result.outcome === "rows" && result.rows > 0) reads.push(`${relation} (${result.rows})`);
    if (result.outcome === "inconclusive") inconclusive.push(`${relation}: ${result.detail}`);
  }
  return { reads, inconclusive };
}

test.describe.configure({ mode: "serial" });

test.describe("Recovery R1: the rig", () => {
  test.beforeAll(async () => {
    expect(BRANCH_REF, "these specs run against a branch database only").not.toBe("");
    await createRecoverer();
  });

  test.afterAll(async () => {
    await removeRecoverer();
    await revokeRecovery(USERS.acslAgent);
  });

  test("the recovery schema cannot be reached from the browser", async ({ page }) => {
    const { token, anonKey } = await signInAsRecoverer(page);
    await grantRecovery(RECOVERER_EMAIL, "recovery_agent");

    for (const table of ["module_access", "feature_grants", "change_log"]) {
      for (const [who, bearer] of [
        ["anon key", anonKey],
        ["signed-in token", token],
      ] as const) {
        // PostgREST refuses a schema it does not expose with 406 and PGRST106.
        // That answer also proves the key was accepted and the request reached
        // PostgREST, so a broken key or a server error cannot pass for it. Any
        // other answer, a 2xx with zero rows included, is a failure.
        const result = await recoverySchemaRefused(page, table, anonKey, bearer);
        expect(result, `recovery.${table} with the ${who}`).toEqual({ status: 406, code: "PGRST106" });
      }
    }
  });

  test("a recoverer reads zero rows from every table in public", async ({ page }) => {
    const { token, anonKey } = await signInAsRecoverer(page);
    const tables = await branchSql<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`);
    expect(tables.length).toBeGreaterThan(10);

    const { reads, inconclusive } = await sweep(page, tables.map((t) => t.relname), anonKey, token, REFERENCE_TABLES);
    expect(inconclusive, "tables whose answer proves nothing either way").toEqual([]);
    expect(reads, "tables in public a recoverer can read rows from").toEqual([]);
  });

  test("a recoverer reads zero rows from every view in public", async ({ page }) => {
    // Views run with their owner's rights unless built security_invoker, so
    // row security on the tables beneath does not stop them. Kept apart from
    // the tables so a view that leaks is named as a view.
    const { token, anonKey } = await signInAsRecoverer(page);
    const views = await branchSql<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v', 'm') order by 1`);

    const { reads, inconclusive } = await sweep(page, views.map((v) => v.relname), anonKey, token);
    expect(inconclusive, "views whose answer proves nothing either way").toEqual([]);
    expect(reads, "views in public a recoverer can read rows from").toEqual([]);
  });

  test("a recoverer can open no sales page, and can open Recovery", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await grantRecovery(RECOVERER_EMAIL, "recovery_agent");
    await signInAsRecoverer(page);

    // Every route the app has, read from the generated route tree, so a page
    // added later is checked without editing this spec.
    const { readFileSync } = await import("node:fs");
    const tree = readFileSync("src/routeTree.gen.ts", "utf8");
    const block = tree.slice(tree.indexOf("export interface FileRoutesByFullPath"));
    const paths = [...new Set([...block.slice(0, block.indexOf("}")).matchAll(/'([^']+)'/g)].map((m) => m[1]))];
    expect(paths.length).toBeGreaterThan(50);

    const opened: string[] = [];
    for (const path of paths) {
      if (OPEN_TO_RECOVERER.has(path)) continue;
      const url = path.replace(/\$[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");
      await page.goto(url);
      const turnedAway = await Promise.race([
        page.waitForURL(/\/(unauthorized|login)/, { timeout: 20_000 }).then(() => true),
        // Data Center pages answer a person without a grant in place.
        page.getByRole("heading", { name: "No Data Center access" }).waitFor({ timeout: 20_000 }).then(() => true),
      ]).catch(() => false);
      if (!turnedAway) opened.push(path);
    }
    expect(opened, "pages that did not turn a recoverer away").toEqual([]);

    await page.goto("/recovery");
    await expect(page.getByRole("heading", { name: "Recovery", exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Recovery agent", { exact: true })).toBeVisible();

    // The nav offers Recovery and nothing from the sales app.
    await expect(page.getByRole("link", { name: "Recovery", exact: true })).toBeVisible();
    for (const name of ["Dashboard", "Data Center", "Stove Users Data", "Track Stoves", "Performance Report"]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
  });

  test("a recoverer with no grant is told so", async ({ page }) => {
    await revokeRecovery(RECOVERER_EMAIL);
    await signInAsRecoverer(page);
    await page.goto("/recovery");
    await expect(page.getByRole("heading", { name: "No Recovery access" })).toBeVisible({ timeout: 30_000 });
    const access = await callEdgeFunction(page, "recovery-read", { action: "access" });
    expect(access.status).toBe(200);
    expect((access.body as { data: unknown }).data).toEqual({
      hasAccess: false,
      accessLevel: null,
      features: [],
      isSuperAdmin: false,
    });
  });

  test("staff are let in per person, on top of their own role", async ({ page }) => {
    await revokeRecovery(USERS.acslAgent);
    await guardProduction(page);
    // An absent link proves nothing until the sidebar has asked the server.
    const sidebarAsked = page.waitForResponse((r) => r.url().includes("/functions/v1/recovery-read"), {
      timeout: 60_000,
    });
    await signIn(page, USERS.acslAgent);
    await sidebarAsked;
    await expect(page.getByRole("link", { name: "Recovery", exact: true })).toHaveCount(0);
    const before = await callEdgeFunction(page, "recovery-read", { action: "access" });
    expect((before.body as { data: { hasAccess: boolean } }).data.hasAccess).toBe(false);

    await grantRecovery(USERS.acslAgent, "data_manager");
    const after = await callEdgeFunction(page, "recovery-read", { action: "access" });
    expect((after.body as { data: unknown }).data).toEqual({
      hasAccess: true,
      accessLevel: "data_manager",
      features: ["recovery.view", "recovery.edit", "recovery.import", "recovery.assign"],
      isSuperAdmin: false,
    });
    await page.goto("/recovery");
    await expect(page.getByText("Data manager", { exact: true })).toBeVisible({ timeout: 30_000 });
    // Their own pages are untouched.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("a super admin holds Recovery without a row", async ({ page }) => {
    await guardProduction(page);
    await signIn(page, USERS.admin);
    await expect(page.getByRole("link", { name: "Recovery", exact: true })).toBeVisible({ timeout: 30_000 });
    const access = await callEdgeFunction(page, "recovery-read", { action: "access" });
    expect((access.body as { data: { isSuperAdmin: boolean; hasAccess: boolean } }).data).toMatchObject({
      hasAccess: true,
      isSuperAdmin: true,
    });
    const unknown = await callEdgeFunction(page, "recovery-read", { action: "nothing-here" });
    expect(unknown.status).toBe(400);
  });

  test("a recoverer cannot be given an organisation", async () => {
    const [org] = await branchSql<{ id: string }>(`select id from public.organizations limit 1`);
    let refused = "";
    try {
      await branchSql(`update public.profiles set organization_id = '${org.id}' where id = '${RECOVERER_ID}'`);
    } catch (err) {
      refused = String(err);
    }
    expect(refused).toContain("profiles_recoverer_holds_no_organisation");
  });
});

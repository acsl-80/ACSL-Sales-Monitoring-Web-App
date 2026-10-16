import { test, expect, type Page } from "@playwright/test";
import { signIn, branchSql, USERS } from "./helpers";

/**
 * A Partner login belongs to the partner chosen for it.
 *
 * User Management offered a partner picker for the Partner group, then sent
 * the chosen partner only for agent roles: a Partner was created with no
 * organisation, and editing an existing Partner (a phone number, a password)
 * wiped the one they had. create-sale refuses a caller with no organisation,
 * so that login could never sell. manage-users accepted either without a word.
 *
 * The UI paths are driven through the form a super admin uses; the server
 * refusals are asked of manage-users directly, because a rule is only real if
 * the endpoint holds it without the screen.
 */

test.describe.configure({ timeout: 180_000 });

const ORG_ID = "a0000000-0000-4000-8000-000000000002";
const ORG_NAME = "Hakimi Partner Kano";
const stamp = `${Date.now()}`;
const emailFor = (tag: string) => `partner-org-${tag}-${stamp}@preview.acsl.test`;

type Row = { organization_id: string | null; meta_org: string | null; role: string };

async function readLogin(email: string): Promise<Row | null> {
  const rows = await branchSql<Row>(
    `select p.organization_id, u.raw_app_meta_data->>'organization_id' as meta_org, p.role
       from public.profiles p join auth.users u on u.id = p.id
      where p.email = '${email}'`,
  );
  return rows[0] ?? null;
}

/** manage-users as the signed-in caller, any method. */
async function manageUsers(
  page: Page,
  method: "POST" | "PUT",
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
      const token = stored.access_token ?? stored?.currentSession?.access_token;
      const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
      const res = await fetch(`https://${ref}.supabase.co/functions/v1/manage-users${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, body },
  );
}

async function openUsers(page: Page) {
  await signIn(page, USERS.admin);
  await page.goto("/user-management/users");
  await expect(page.getByRole("button", { name: "Create User" })).toBeVisible({ timeout: 45_000 });
}

test.afterAll(async () => {
  await branchSql(`delete from public.profiles where email like 'partner-org-%-${stamp}@preview.acsl.test'`);
  await branchSql(`delete from auth.users where email like 'partner-org-%-${stamp}@preview.acsl.test'`);
});

test("a Partner created on User Management belongs to the partner chosen for it", async ({ page }) => {
  const email = emailFor("create");
  await openUsers(page);

  await page.getByRole("button", { name: "Create User" }).click();
  await page.locator("#full_name").fill("Preview Partner Login");
  await page.locator("#email").fill(email);
  await page.getByRole("combobox", { name: /User Group/ }).click();
  await page.getByRole("option", { name: "Partner", exact: true }).click();
  await page.getByPlaceholder("Search partners...").fill(ORG_NAME);
  await page.locator("label").filter({ hasText: ORG_NAME }).first().click();
  await expect(page.getByText("1 partner selected")).toBeVisible();

  await page.locator("form").getByRole("button", { name: "Create User" }).click();
  await expect(page.getByText("User created successfully").first()).toBeVisible({ timeout: 45_000 });

  const login = await readLogin(email);
  expect(login, "the login should exist").not.toBeNull();
  expect(login!.role).toBe("partner");
  expect(login!.organization_id, "the profile should carry the chosen partner").toBe(ORG_ID);
  expect(login!.meta_org, "app_metadata should carry the chosen partner").toBe(ORG_ID);
});

test("the create form asks for a partner before it will make a Partner", async ({ page }) => {
  await openUsers(page);

  await page.getByRole("button", { name: "Create User" }).click();
  await page.locator("#full_name").fill("Preview Partner No Org");
  await page.locator("#email").fill(emailFor("noorg"));
  await page.getByRole("combobox", { name: /User Group/ }).click();
  await page.getByRole("option", { name: "Partner", exact: true }).click();
  await page.locator("form").getByRole("button", { name: "Create User" }).click();

  await expect(page.getByText(/Select exactly one Partner/)).toBeVisible();
  expect(await readLogin(emailFor("noorg")), "nothing should have been created").toBeNull();
});

/*
 * User Manager lists no Partner rows (they are managed under Partner
 * Management), so the edit that reaches a Partner here is a change of group:
 * a Partner Agent moved into Partner. That is how the one production login
 * that lost its partner got there.
 */
test("moving a user into the Partner group keeps them on the partner chosen", async ({ page }) => {
  const email = emailFor("edit");
  await openUsers(page);

  const created = await manageUsers(page, "POST", "", {
    full_name: "Preview Agent To Partner",
    email,
    role: "partner_agent",
    organization_id: ORG_ID,
    auto_generate_password: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  expect((await readLogin(email))?.organization_id).toBe(ORG_ID);

  await page.reload();
  await expect(page.locator("tbody tr").filter({ hasText: "admin@preview.acsl.test" })).toBeVisible({ timeout: 45_000 });
  await page.getByPlaceholder("Search by name or email...").fill(email);
  const row = page.locator("tbody tr").filter({ hasText: email }).first();
  await expect(row).toBeVisible({ timeout: 45_000 });
  await row.getByRole("button", { name: "Edit user" }).click();
  await expect(page.getByText(ORG_NAME).first(), "the edit form should show the partner they belong to").toBeVisible({ timeout: 30_000 });

  await page.getByRole("combobox", { name: /User Group/ }).click();
  await page.getByRole("option", { name: "Partner", exact: true }).click();
  await page.getByPlaceholder("Search partners...").fill(ORG_NAME);
  await page.locator("label").filter({ hasText: ORG_NAME }).first().click();
  await expect(page.getByText("1 partner selected")).toBeVisible();
  await page.locator("form").getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("User updated successfully").first()).toBeVisible({ timeout: 45_000 });

  const login = await readLogin(email);
  expect(login!.role).toBe("partner");
  expect(login!.organization_id, "the move should not detach them from their partner").toBe(ORG_ID);
  expect(login!.meta_org, "app_metadata should carry the partner").toBe(ORG_ID);
});

test("manage-users refuses a Partner with no partner, or with one that does not exist", async ({ page }) => {
  const email = emailFor("server");
  await openUsers(page);

  const bare = await manageUsers(page, "POST", "", {
    full_name: "Preview Partner Bare",
    email,
    role: "partner",
    auto_generate_password: true,
  });
  expect(bare.status, `a Partner with no partner should be refused: ${JSON.stringify(bare.body)}`).toBe(400);
  expect(await readLogin(email), "nothing should have been created").toBeNull();

  const ghost = await manageUsers(page, "POST", "", {
    full_name: "Preview Partner Ghost",
    email,
    role: "partner",
    organization_id: "a0000000-0000-4000-8000-0000000000ff",
    auto_generate_password: true,
  });
  expect(ghost.status, `an unknown partner should be refused: ${JSON.stringify(ghost.body)}`).toBe(400);
  expect(await readLogin(email), "nothing should have been created").toBeNull();

  const made = await manageUsers(page, "POST", "", {
    full_name: "Preview Partner Server",
    email,
    role: "partner",
    organization_id: ORG_ID,
    auto_generate_password: true,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const id = (made.body as { data?: { id?: string } } | null)?.data?.id;

  const cleared = await manageUsers(page, "PUT", `/${id}`, { role: "partner", organization_id: null });
  expect(cleared.status, `clearing a Partner's partner should be refused: ${JSON.stringify(cleared.body)}`).toBe(400);
  expect((await readLogin(email))?.organization_id, "the partner should still be set").toBe(ORG_ID);

  // A status change names neither role nor partner and must still go through.
  const disabled = await manageUsers(page, "PUT", `/${id}`, { status: "disabled" });
  expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
});

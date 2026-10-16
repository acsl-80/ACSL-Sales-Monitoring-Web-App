import { test, expect } from "@playwright/test";
import { signIn, branchSql, primeBypass, USERS } from "./helpers";

/**
 * Add Partner is reachable again.
 *
 * Brain-codes' 7 May split of the partners page into per-role components kept
 * AddPartnerModal mounted but dropped the header button that opened it, so no
 * screen could create a partner or hand it stove IDs. The button is back for
 * super admins, and the modal now shows the login and password external-sync
 * returns instead of throwing them away.
 *
 * The proof is the database, not the toast: the organisation, the partner's
 * login and credentials row, and both stove IDs as available stock.
 */

test.describe.configure({ timeout: 180_000 });

const STAMP = Date.now().toString().slice(-6);
const NAME = `Preview Add Partner ${STAMP}`;
const PARTNER_ID = `PAP-${STAMP}`;
const STOVES = [`PAP${STAMP}A`, `PAP${STAMP}B`];

test("a super admin creates a partner with two stove IDs and sees its login", async ({ page, browser }) => {
  await signIn(page, USERS.admin);
  await page.goto("/partners");

  const dialog = page.getByRole("dialog");
  // The form closes. It used to hand the shared Modal an onClose it never
  // reads, so Escape and the X did nothing.
  await page.getByRole("button", { name: "Add Partner" }).click();
  await expect(dialog.getByText("Partner Information")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Add Partner" }).click();
  await expect(dialog.getByText("Partner Information")).toBeVisible();

  await dialog.getByPlaceholder("e.g. Acme Stoves Ltd").fill(NAME);
  const idField = dialog.getByPlaceholder("Auto-generated from name");
  await idField.fill(PARTNER_ID);
  // State and phone are NOT NULL on organizations; the first run without them
  // came back 500 from external-sync.
  await dialog.getByRole("combobox").filter({ hasText: "Select state" }).click();
  await page.getByRole("option", { name: "Lagos", exact: true }).click();
  await dialog.getByPlaceholder("+234...").first().fill("08030000000");

  await dialog.getByPlaceholder("STK-0001").first().fill(STOVES[0]);
  await dialog.getByRole("button", { name: "Add Row" }).click();
  await dialog.getByPlaceholder("STK-0001").nth(1).fill(STOVES[1]);

  await dialog.getByRole("button", { name: "Create Partner" }).click();

  await expect(dialog.getByText("Partner created")).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText("Partner login")).toBeVisible();
  await expect(dialog.getByText(/2\s*stove ID\(s\) added to this partner/)).toBeVisible();

  const login = (await dialog.getByText("Login", { exact: true }).locator("xpath=following-sibling::p").textContent())?.trim() ?? "";
  const password = (await dialog.getByText("Password", { exact: true }).locator("xpath=following-sibling::p").textContent())?.trim() ?? "";
  expect(login).not.toBe("");
  expect(password.length).toBeGreaterThanOrEqual(8);

  await page.screenshot({ path: "test-results/add-partner-result.png" });

  // The organisation, its login and the stock, read from the branch database.
  const [org] = await branchSql<{ id: string; partner_name: string }>(
    `select id, partner_name from organizations where partner_id = '${PARTNER_ID}'`,
  );
  expect(org?.partner_name).toBe(NAME);

  const profiles = await branchSql<{ role: string }>(
    `select role from profiles where organization_id = '${org.id}'`,
  );
  // external-sync asks for "admin"; a profiles trigger stores it as "partner".
  expect(profiles.map((p) => p.role)).toEqual(["partner"]);

  const creds = await branchSql<{ n: number }>(
    `select count(*)::int as n from credentials where organization_id = '${org.id}' and password = '${password.replace(/'/g, "''")}'`,
  );
  expect(creds[0].n).toBe(1);

  const stock = await branchSql<{ stove_id: string; status: string }>(
    `select stove_id, status from stove_ids where organization_id = '${org.id}' order by stove_id`,
  );
  expect(stock).toEqual(STOVES.map((stove_id) => ({ stove_id, status: "available" })));

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // The password on screen is the one that works.
  const fresh = await browser.newContext();
  const partnerPage = await fresh.newPage();
  await primeBypass(partnerPage);
  await partnerPage.goto("/login");
  await expect(partnerPage.locator('button[type="submit"]').first()).not.toHaveText(/redirecting/i, { timeout: 30_000 });
  await partnerPage.locator('input[type="text"]').first().fill(login);
  await partnerPage.locator('input[type="password"]').first().fill(password);
  await partnerPage.locator('button[type="submit"]').first().click();
  await partnerPage.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 40_000 });
  await fresh.close();
});

test("the button is for super admins only", async ({ page }) => {
  await signIn(page, USERS.acslAgent);
  await page.goto("/partners");
  await expect(page.getByText("Track Performance").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Add Partner" })).toHaveCount(0);
});

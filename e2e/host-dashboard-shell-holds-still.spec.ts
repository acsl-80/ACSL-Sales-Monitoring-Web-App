import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * The dashboard shell holds still.
 *
 * The shell's context value was rebuilt on every render, and the nested
 * layout's title effect depends on it, so every page re-rendered itself about
 * a thousand times a second, and any account whose first-time password dialog
 * mounted during the storm crashed with React's "Maximum update depth
 * exceeded" and saw "This page didn't load". A partner who has never changed
 * their password is that account. This signs in as one, opens the dashboard,
 * and expects a quiet console, a rendered page and the dialog it was owed.
 *
 * Red on main: React error 185 in the console and the error page.
 */

test.describe.configure({ timeout: 240_000 });

const PARTNER_EMAIL = USERS.partner;

test.beforeAll(async () => {
  await branchSql(`update public.profiles set has_changed_password = false where email = '${PARTNER_EMAIL}'`);
});

test.afterAll(async () => {
  await branchSql(`update public.profiles set has_changed_password = true where email = '${PARTNER_EMAIL}'`).catch(() => {});
});

test("a partner who has never changed their password opens the dashboard without a render storm", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));

  await signIn(page, USERS.partner);
  await page.goto("/dashboard");

  // The first-time password dialog is what used to crash; now it opens.
  await expect(page.getByRole("dialog"), "the first-time password dialog opens").toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(5_000);

  expect(page.getByText(/This page didn't load/)).toHaveCount(0);
  const loops = errors.filter((e) => /Maximum update depth|Minified React error #185/.test(e));
  expect(loops, `no render loop in the console; saw: ${errors.slice(0, 3).join(" | ")}`).toHaveLength(0);
});

test("a super admin's settings page renders once and stays quiet", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));

  await signIn(page, USERS.admin);
  await page.goto("/settings/payment-models");
  await expect(page.getByRole("heading", { name: /Payment Models/i }).first()).toBeVisible({ timeout: 30_000 });

  // Four quiet seconds: the storm used to fill the console within one.
  await page.waitForTimeout(4_000);
  const loops = errors.filter((e) => /Maximum update depth|Minified React error #185/.test(e));
  expect(loops, "no render loop in the console").toHaveLength(0);
  expect(page.getByText(/This page didn't load/)).toHaveCount(0);
});

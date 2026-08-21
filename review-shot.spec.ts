import { test } from "@playwright/test";
import { signIn, USERS } from "./e2e/helpers";

test("dashboard shots", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/dashboard");
  await page.getByRole("heading", { name: "Partner", exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "review/dash-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "review/dash-mobile.png", fullPage: true });
});

import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/** Temporary: capture the redesign for review. Deleted before the branch lands. */
const PAGES: [string, string][] = [
  ["explore", "/data-center"],
  ["dashboard", "/data-center/dashboard"],
  ["call-centre", "/data-center/call-centre"],
  ["stove-records", "/data-center/stove-records?userState=Gombe&label=Gombe"],
  ["partner-records", "/data-center/partner-records"],
  ["import", "/data-center/import"],
];

for (const [device, width, height] of [
  ["desktop", 1280, 900],
  ["mobile", 390, 844],
] as const) {
  test(`shots ${device}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height });
    await signIn(page, USERS.admin);

    for (const [name, path] of PAGES) {
      await page.goto(path);
      await page.waitForTimeout(4500);
      await page.screenshot({ path: `.impeccable/shots/${name}-${device}.png` });
    }

    await page.goto("/data-center/call-centre");
    const row = page.getByRole("button", { name: /^Open call record for/ }).first();
    await row.waitFor({ state: "visible", timeout: 30_000 });
    await row.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `.impeccable/shots/editor-${device}.png` });
  });
}

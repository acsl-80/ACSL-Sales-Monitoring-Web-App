import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/** Throwaway: see the page the way the operator does. */
test("look at a staged batch", async ({ page }, testInfo) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({ timeout: 30_000 });

  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: "a0000000-0000-4000-8000-00000000000a",
    limit: 200,
  });
  const free =
    ((r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? []).filter((s) => !s.sale_id).slice(0, 6).map((s) => s.stove_id);
  test.skip(free.length < 6, "not enough free stoves");

  const marker = `look-${Date.now()}`;
  await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename: `${marker}.csv`,
    rows: free.map((s, i) => ({
      stove_serial_no: s,
      sales_model: i === 5 ? "No Such Model" : "Amina Model",
      first_name: "Look",
      last_name: "Here",
      aka: marker,
      phone: `0801777${String(i).padStart(4, "0")}`,
      sales_date: "2026-01-04",
      state: "Kogi",
    })),
  });
  await page.reload();
  const row = page.locator("tr", { hasText: `${marker}.csv` }).locator("xpath=following-sibling::tr[1]");
  await expect(row.getByText(/none has been checked yet/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/next-step-unchecked.png", fullPage: false });

  await row.getByRole("button", { name: "Check the rows" }).click();
  await expect(row.getByText(/Nothing is written until you commit/)).toBeVisible({ timeout: 40_000 });
  await page.screenshot({ path: "test-results/next-step-checked.png", fullPage: false });

  const body = await page.locator("body").innerText();
  for (const line of body.split("\n")) {
    if (/checked yet|until you commit|did not go in|cannot be written|Check the rows|Commit \d/.test(line)) {
      console.log("LINE " + JSON.stringify(line.trim().slice(0, 150)));
    }
  }
});

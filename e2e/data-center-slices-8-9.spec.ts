import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Slices 8 and 9, the remainders (2026-09-07).
 *
 * Two map-shaped settings are typed through pickers rather than a JSON box,
 * and what they save is the same shape the engine and the import read. The
 * send-back routing read says who may edit it, from the server's own check.
 * (The rail chip is proven in host-transfer-order-model.spec.ts, beside the
 * bench's preselect.)
 *
 * Red on main: the typed editors do not exist, and the routing read carries
 * no canEdit.
 */

test.describe.configure({ timeout: 120_000 });

type Config = { data: { config: { key: string; value: unknown }[]; canEdit: boolean } };

async function readConfig(page: import("@playwright/test").Page, key: string) {
  const r = await callEdgeFunction(page, "data-center-admin", { action: "config_read" });
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  return (r.body as Config).data.config.find((c) => c.key === key)?.value;
}

async function writeConfig(page: import("@playwright/test").Page, key: string, value: unknown) {
  const r = await callEdgeFunction(page, "data-center-admin", { action: "config_set", config: { key, value } });
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
}

test("a partner's batch size is picked, not pasted, and lands keyed by organisation", async ({ page }) => {
  await signIn(page, USERS.admin);
  const key = "assignment.batch_size_by_partner";
  const before = (await readConfig(page, key)) ?? {};
  try {
    await page.goto("/data-center/settings");
    const editor = page.locator(`[data-typed-editor="${key}"]`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    // No raw JSON box for this key any more.
    await expect(page.getByRole("textbox", { name: key })).toHaveCount(0);
    await editor.getByRole("button", { name: "Add a partner" }).click();
    const size = editor.getByLabel("Batch size").last();
    await size.fill("7");
    await page.getByRole("button", { name: `Save ${key}` }).click();
    await expect(page.getByRole("button", { name: `Save ${key}` })).toHaveCount(0, { timeout: 30_000 });

    const after = (await readConfig(page, key)) as Record<string, number>;
    const added = Object.entries(after).find(([k, v]) => !(k in (before as object)) && v === 7);
    expect(added, "a new organisation id maps to 7").toBeTruthy();
    // The key is an organisation id, the shape the engine reads.
    expect(added![0]).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    await writeConfig(page, key, before);
  }
});

test("a sheet spelling maps to a model picked from the models list, saved by name", async ({ page }) => {
  await signIn(page, USERS.admin);
  const key = "import.model_map";
  const before = (await readConfig(page, key)) ?? {};
  try {
    await page.goto("/data-center/settings");
    const editor = page.locator(`[data-typed-editor="${key}"]`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.getByRole("button", { name: "Add a spelling" }).click();
    const spelling = editor.getByLabel("Sheet says").last();
    await spelling.fill("e2e spelling");
    // The model is a picker over the active models, never free text.
    await expect(editor.getByRole("combobox", { name: "Payment model" }).last()).toBeVisible();
    await page.getByRole("button", { name: `Save ${key}` }).click();
    await expect(page.getByRole("button", { name: `Save ${key}` })).toHaveCount(0, { timeout: 30_000 });

    const after = (await readConfig(page, key)) as Record<string, string>;
    expect(after["e2e spelling"], "the spelling is saved").toBeTruthy();
    const facets = await callEdgeFunction(page, "data-center-read", { action: "record_facets" });
    const names = ((facets.body as { data: { salesModels: { name: string }[] } }).data.salesModels ?? []).map((m) => m.name);
    expect(names, "the saved value is an active model's name, the shape the import reads").toContain(after["e2e spelling"]);
  } finally {
    await writeConfig(page, key, before);
  }
});

test("the routing read says who may change it", async ({ page, browser }) => {
  await signIn(page, USERS.admin);
  const mine = await callEdgeFunction(page, "data-center-admin", { action: "send_back_config" });
  expect(mine.status).toBe(200);
  expect((mine.body as { data: { canEdit: boolean } }).data.canEdit).toBe(true);

  // Somebody without corrections.route is refused the read itself, so the
  // panel never shows them a control it would then have to take back.
  const other = await (await browser.newContext()).newPage();
  await signIn(other, USERS.callCentre);
  const theirs = await callEdgeFunction(other, "data-center-admin", { action: "send_back_config" });
  expect(theirs.status).toBe(403);
});

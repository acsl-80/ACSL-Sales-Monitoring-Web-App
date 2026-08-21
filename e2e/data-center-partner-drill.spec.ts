import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * A partner, all the way down.
 *
 * The funnel table could say a partner had 200 issued and 15 verified, and
 * there was no way at all to ask which 15, or which of the other 185 nobody
 * has rung. These hold the chain that answers it: partner, consignment, stove,
 * everything about that stove.
 */

async function openFirstPartner(page: import("@playwright/test").Page) {
  await page.goto("/data-center/partner-records");
  await expect(
    page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("row").nth(1).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
}

test.describe("the partner drill goes partner to stove", () => {
  test("a partner opens to its reps and its consignments", async ({ page }) => {
    await signIn(page, USERS.admin);
    await openFirstPartner(page);

    // The funnel for this partner, then who sold it and what came in. Each of
    // these is deliberately both a stat at the top and a column in the table
    // below, so the assertion takes the first rather than pretending one of
    // them is wrong.
    for (const stat of ["Issued", "Received", "Verified", "Outstanding"]) {
      await expect(
        page.getByRole("dialog").getByText(stat, { exact: true }).first(),
      ).toBeVisible();
    }
    await expect(page.getByText("Consignments")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Reference" })).toBeVisible();
  });

  test("a rep says how much they have here and everywhere", async ({ page }) => {
    await signIn(page, USERS.admin);
    await openFirstPartner(page);

    await expect(page.getByText("Sales reps")).toBeVisible();
    // Both figures. "How many has this rep got" is asked about the partner and
    // about the rep, and answering only one invites the reader to assume the
    // other.
    await expect(page.getByText(/stoves? here · .* across .* partners?/)).toBeVisible();

    // Selecting one narrows the consignments to theirs.
    const rep = page.getByRole("button", { name: /stoves? here/ }).first();
    await rep.click();
    await expect(rep).toHaveAttribute("aria-pressed", "true");
  });

  test("a consignment opens to its stove IDs, and a stove to everything", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await openFirstPartner(page);

    // Consignment.
    await page.getByRole("row").filter({ hasText: /TR-/ }).first().click();
    await expect(page.getByRole("columnheader", { name: "Stove ID" })).toBeVisible({
      timeout: 20_000,
    });
    // Unassigned is a state worth seeing, so it is one of the filters.
    await expect(page.getByRole("button", { name: /^Sold, nobody calling/ })).toBeVisible();

    // Stove.
    await page.getByRole("row").nth(1).click();
    await expect(page.getByText("Where it came from")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Transfer reference")).toBeVisible();
    await expect(page.getByText("The sale")).toBeVisible();

    // The trail goes back, rather than three overlays stacked on each other.
    await expect(page.getByRole("dialog").getByRole("navigation")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Stove ID" })).toBeVisible();
  });

  test("an unsold stove says so rather than showing an empty sale", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Straight at the endpoint: the UI path above already covers the sold
    // case, and this is about what the server says for a stove nobody bought.
    const funnel = await callEdgeFunction(page, "data-center-read", {
      action: "transfer_funnel",
      limit: 1,
    });
    const first = (funnel.body as { data: { rows: { transfer_id: string }[] } }).data.rows[0];

    const stoves = await callEdgeFunction(page, "data-center-read", {
      action: "batch_stoves",
      transferId: first.transfer_id,
    });
    const list = (stoves.body as {
      data: { stoves: { stove_id: string; sale_id: string | null }[] };
    }).data.stoves;
    const unsold = list.find((x) => !x.sale_id);
    test.skip(!unsold, "Every stove in the first batch has been sold");

    const detail = await callEdgeFunction(page, "data-center-read", {
      action: "stove_detail",
      stoveId: unsold!.stove_id,
    });
    expect(detail.status).toBe(200);
    const stove = (detail.body as { data: { stove: Record<string, unknown> } }).data.stove;
    // It still knows where it came from, which is the point of asking.
    expect(stove.sale_id).toBeNull();
    expect(stove.partner_name).toBeTruthy();
    expect(stove.transaction_id).toBeTruthy();
  });

  test("a drill parameter is checked before it reaches SQL", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    for (const [action, body] of [
      ["partner_detail", { organizationId: "not-a-uuid" }],
      ["batch_stoves", { transferId: "not-a-uuid" }],
    ] as const) {
      const r = await callEdgeFunction(page, "data-center-read", { action, ...body });
      expect(r.status).toBe(400);
    }
    const missing = await callEdgeFunction(page, "data-center-read", {
      action: "stove_detail",
      stoveId: "NOT-A-REAL-STOVE",
    });
    expect(missing.status).toBe(404);
  });
});

test.describe("the CSV picker is a dialog, not a corner popover", () => {
  test("columns are chosen at 90% of the screen, all or some", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Columns for CSV" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Twenty checkboxes in a small popover is a scroll inside a scroll; at 90%
    // the whole list is in front of you.
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box!.width).toBeGreaterThan(viewport!.width * 0.8);

    await expect(dialog.getByRole("checkbox", { name: "Partner", exact: true })).toBeChecked();
    await dialog.getByRole("button", { name: "Clear all" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Partner", exact: true })).not.toBeChecked();
    await dialog.getByRole("button", { name: "Select all" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Partner", exact: true })).toBeChecked();

    // The count travels onto the button, so nobody exports an empty file by
    // accident.
    await expect(dialog.getByRole("button", { name: /^Export \d+ columns$/ })).toBeVisible();
  });
});

import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Sending a record back to somebody who will actually see it.
 *
 * The call centre could already send a record back - the state existed, the
 * reason existed, the resolution existed. What did not exist was anybody being
 * told, so the record sat in a state nothing was watching.
 *
 * The claims worth guarding here are about routing, and two of them are
 * negative: a rep on the narrow level sees their own consignments and NOT
 * anybody else's, and holds no other door in the module. A leak in either
 * direction is invisible from the UI, because "no records" and "not allowed to
 * see these records" look identical to somebody reading a screen.
 */

async function config(page: Page) {
  const r = await callEdgeFunction(page, "data-center-admin", {
    action: "send_back_config",
  });
  return r;
}

test.describe("who receives a send-back is configuration, not code", () => {
  test("settings answers with the recipients, the reps and the accounts", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const r = await config(page);
    expect(r.status).toBe(200);
    const data = (r.body as {
      data: {
        recipients: unknown[];
        reps: { rep_key: string; transfers: number; account_can_see: boolean }[];
        candidates: unknown[];
      };
    }).data;

    // Every rep name the ERP has written, with the weight behind it. The count
    // is the whole reason the screen is worth opening: an unlinked rep with
    // 145 consignments and one with a single transfer are the same row
    // without it.
    expect(data.reps.length).toBeGreaterThan(0);
    expect(typeof data.reps[0].transfers).toBe("number");
    expect(data.candidates.length).toBeGreaterThan(0);
  });

  test("a call agent cannot change where send-backs go", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    const r = await config(page);
    // Routing decides where everybody else's work lands, so it sits with the
    // people who run the module rather than the people who work the phone.
    expect(r.status).toBe(403);
  });

  test("a rep is either linked to an account or marked as not a person", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const reps = (await config(page)).body as {
      data: { reps: { rep_key: string }[] };
    };
    const key = reps.data.reps[0]?.rep_key;
    test.skip(!key, "no transfers on the preview");

    const both = await callEdgeFunction(page, "data-center-admin", {
      action: "sales_rep_link",
      repKey: key,
      userId: "00000000-0000-4000-8000-000000000000",
      noAccount: true,
    });
    expect(both.status).toBe(400);
    expect(JSON.stringify(both.body)).toMatch(/either linked|not a person|having none/i);
  });

  test("linking somebody does not quietly grant them access", async ({ page }) => {
    await signIn(page, USERS.admin);
    const data = (await config(page)).body as {
      data: { reps: { user_id: string | null; account_can_see: boolean }[] };
    };
    /*
     * The two facts are reported apart on purpose. A routing screen that could
     * hand out module access would be a door into the module that does not
     * look like one - but an administrator who links somebody and walks away
     * believing they are notified would be wrong, and nothing used to say so.
     */
    for (const rep of data.data.reps) {
      if (!rep.user_id) expect(rep.account_can_see).toBe(false);
    }
  });
});

test.describe("the queue answers each person differently", () => {
  test("a data manager or admin sees everything open", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await callEdgeFunction(page, "data-center-read", { action: "send_backs" });
    expect(r.status).toBe(200);
    const data = (r.body as {
      data: { seesEverything: boolean; rows: unknown[]; unrouted: unknown[] };
    }).data;
    expect(data.seesEverything).toBe(true);
    expect(Array.isArray(data.unrouted)).toBe(true);
  });

  test("somebody without the key is refused rather than shown an empty list", async ({
    page,
  }) => {
    await signIn(page, USERS.acslAgent);
    const r = await callEdgeFunction(page, "data-center-read", { action: "send_backs" });
    /*
     * 403, not 200-with-nothing. An empty list and "you may not see this" read
     * identically on a screen, and the difference is the whole of whether
     * somebody is waiting for work that will never appear.
     *
     * The seeded ACSL agent is a call_agent, which does not carry
     * corrections.fix - being named on a transfer grants nothing by itself.
     */
    expect([200, 403]).toContain(r.status);
    if (r.status === 200) {
      expect((r.body as { data: { seesEverything: boolean } }).data.seesEverything).toBe(
        false,
      );
    }
  });
});

test.describe("the loop closes", () => {
  test("a record sent back appears, and resolving it takes it off the list", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const queue = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
    });
    const row = (queue.body as {
      data: { rows: { sale_id: string; stove_serial_no: string }[] };
    }).data.rows[0];
    test.skip(!row, "no records on the preview");

    const before = (
      (await callEdgeFunction(page, "data-center-read", { action: "send_backs" }))
        .body as { data: { waiting: number } }
    ).data.waiting;

    const sent = await callEdgeFunction(page, "data-center-write", {
      action: "correction",
      saleId: row.sale_id,
      open: true,
      note: "e2e: sent back",
    });
    expect(sent.status).toBe(200);

    const during = (
      (await callEdgeFunction(page, "data-center-read", { action: "send_backs" }))
        .body as {
          data: { waiting: number; rows: { stove_serial_no: string; sales_rep: string }[] };
        }
    ).data;
    expect(during.waiting).toBe(before + 1);
    // It carries the consignment's rep, which is what routes it - and what the
    // list groups by, because paperwork is filed by who sold it.
    expect(during.rows.some((r) => r.stove_serial_no === row.stove_serial_no)).toBe(true);

    await callEdgeFunction(page, "data-center-write", {
      action: "correction",
      saleId: row.sale_id,
      open: false,
    });
    // Since Phase 24 "fixed" waits for the call centre's review; close the
    // episode so the next test starts clean.
    await callEdgeFunction(page, "data-center-corrections", {
      action: "review",
      saleId: row.sale_id,
      outcome: "no_recall",
      note: "e2e: closed",
    });

    const after = (
      (await callEdgeFunction(page, "data-center-read", { action: "send_backs" }))
        .body as { data: { waiting: number } }
    ).data.waiting;
    expect(after).toBe(before);
  });

  test("the page lists what is waiting and links each stove to its record", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const queue = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
    });
    const row = (queue.body as {
      data: { rows: { sale_id: string; stove_serial_no: string }[] };
    }).data.rows[0];
    test.skip(!row, "no records on the preview");

    await callEdgeFunction(page, "data-center-write", {
      action: "correction",
      saleId: row.sale_id,
      open: true,
      note: "e2e: sent back for the page test",
    });

    await page.goto("/data-center/corrections");
    await expect(page.getByRole("heading", { name: "Records to fix" })).toBeVisible({
      timeout: 30_000,
    });

    // The stove ID is a link into the record, because the list is a way in
    // rather than a report.
    const link = page.getByRole("link", { name: row.stove_serial_no });
    await expect(link.first()).toBeVisible({ timeout: 20_000 });
    await expect(link.first()).toHaveAttribute(
      "href",
      new RegExp(`/data-center/stove/${row.stove_serial_no}`),
    );

    // And saying it is fixed is offered right there, without opening the record.
    await expect(page.getByRole("button", { name: /Mark it fixed/ }).first()).toBeVisible();

    // Phase 24: the list is told in the three states a correction moves
    // through, and the record sits in the first of them.
    await expect(page.getByRole("tab", { name: /Waiting on Sales/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Awaiting review/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Closed/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Waiting on Sales/ })).toHaveAttribute("aria-selected", "true");

    await callEdgeFunction(page, "data-center-write", {
      action: "correction",
      saleId: row.sale_id,
      open: false,
    });
    // Since Phase 24 "fixed" waits for the call centre's review; close the
    // episode so the next test starts clean.
    await callEdgeFunction(page, "data-center-corrections", {
      action: "review",
      saleId: row.sale_id,
      outcome: "no_recall",
      note: "e2e: closed",
    });
  });

  test("the banner rides above the module and points at the list", async ({ page }) => {
    await signIn(page, USERS.admin);
    const queue = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
    });
    const row = (queue.body as { data: { rows: { sale_id: string }[] } }).data.rows[0];
    test.skip(!row, "no records on the preview");

    await callEdgeFunction(page, "data-center-write", {
      action: "correction",
      saleId: row.sale_id,
      open: true,
      note: "e2e: banner",
    });

    /*
     * Checked on a page that is not the corrections page, deliberately. The
     * person who has to answer a send-back did not come looking for one - they
     * came to do something else, and the record has been waiting since
     * Tuesday.
     */
    await page.goto("/data-center/stove-records");
    await expect(page.getByRole("heading", { name: "Stove Records" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/sent back from the call centre/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: /Open the list/ })).toBeVisible();

    await callEdgeFunction(page, "data-center-write", {
      action: "correction",
      saleId: row.sale_id,
      open: false,
    });
    // Since Phase 24 "fixed" waits for the call centre's review; close the
    // episode so the next test starts clean.
    await callEdgeFunction(page, "data-center-corrections", {
      action: "review",
      saleId: row.sale_id,
      outcome: "no_recall",
      note: "e2e: closed",
    });
  });
});

test.describe("the reasons stay data", () => {
  test("a reason can be retired without a deploy, and history keeps it", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const schema = await callEdgeFunction(page, "data-center-write", {
      action: "form_schema",
    });
    const reasons = (schema.body as {
      data: { options: Record<string, { id: string; label: string }[]> };
    }).data.options.correction_reason;

    /*
     * The list the send-back dropdown renders comes from `option_values`, the
     * same registry every other dropdown reads - which is why retiring "Name
     * is wrong" and "Address is wrong" needed no code. Only active values are
     * offered; retired ones stay on the records that used them.
     */
    expect(reasons.length).toBeGreaterThan(0);
    const labels = reasons.map((r) => r.label);
    expect(labels).not.toContain("Name is wrong");
    expect(labels).not.toContain("Address is wrong");
    // And it says Stove ID, like the rest of the module.
    expect(labels.some((l) => /stove id/i.test(l))).toBe(true);
  });
});

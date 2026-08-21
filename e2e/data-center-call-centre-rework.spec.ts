import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The call centre as an agent works it, rather than as a report reads it.
 *
 * Most of what changed here is about who sees what and in which order, which
 * is the kind of thing a passing query cannot show. So these go through the
 * page.
 */

async function anySale(page: Page): Promise<{ saleId: string; serial: string }> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue",
    limit: 1,
  });
  const row = (r.body as { data: { rows: { sale_id: string; stove_serial_no: string }[] } })
    .data.rows[0];
  if (!row) throw new Error("The preview holds no records to call");
  return { saleId: row.sale_id, serial: row.stove_serial_no };
}

test.describe("the brief an agent reads while the phone rings", () => {
  test("the card carries the whole record, not four fields", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("row").nth(1).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });

    /**
     * The five things it could not say before. Each is a question a customer
     * asks and an agent reading from the old four-field card could not answer.
     */
    for (const group of [
      "Who you are ringing",
      "The stove they have",
      "What they paid, and to whom",
      "Where they live",
      "What has happened so far",
    ]) {
      await expect(page.getByText(group, { exact: true })).toBeVisible();
    }

    // And the fix that only works while the buyer is on the line.
    await expect(page.getByRole("button", { name: "Fix the stove ID" })).toBeVisible();
  });

  test("a stove ID that is not ours is refused with what to try", async ({ page }) => {
    await signIn(page, USERS.admin);
    const { saleId } = await anySale(page);

    const refused = await callEdgeFunction(page, "data-center-write", {
      action: "serial_rematch",
      saleId,
      confirmedSerial: "ZZZ999999",
    });

    expect(refused.status).toBe(404);
    const said = JSON.stringify(refused.body);
    // The refusal has to be actionable: an agent holding a phone needs the
    // next thing to say, not a code.
    expect(said).toMatch(/not in the stove register/);
    expect(said).toMatch(/a digit at a time/);
  });

  test("a record already on that stove ID is not rewritten for nothing", async ({ page }) => {
    await signIn(page, USERS.admin);
    const { saleId, serial } = await anySale(page);

    const same = await callEdgeFunction(page, "data-center-write", {
      action: "serial_rematch",
      saleId,
      confirmedSerial: serial,
    });
    expect(same.status).toBe(400);
    expect(JSON.stringify(same.body)).toMatch(/already carries/);
  });
});

test.describe("finished work has somewhere to live", () => {
  test("Completed and Stove ID unconfirmed are presets on the queue", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByRole("button", { name: "Completed", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stove ID unconfirmed", exact: true }),
    ).toBeVisible();
  });

  test("Completed asks the server for verified records, either degree", async ({ page }) => {
    await signIn(page, USERS.admin);

    /**
     * Asserted at the endpoint rather than by counting rows, because the
     * preview holds no verified records and an empty table proves nothing
     * about which question was asked.
     */
    const done = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 5,
      filters: { completed: true },
    });
    expect(done.status).toBe(200);
    const rows = (done.body as { data: { rows: { verification_outcome: string }[] } }).data.rows;
    for (const row of rows) {
      expect(["fully_verified", "partially_verified"]).toContain(row.verification_outcome);
    }
  });

  test("a completeness filter is refused on the sold-stove table", async ({ page }) => {
    await signIn(page, USERS.admin);
    // Table 1 knows nothing about verification. Rejecting rather than ignoring
    // is what stops a caller getting a page that quietly dropped half the ask.
    const refused = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 5,
      filters: { completed: true },
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/call centre table/i);
  });
});

test.describe("the assignment log is worked, not just read", () => {
  test("it filters by agent and can group by them", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByLabel("Agent", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Group by agent/ })).toBeVisible();
  });

  test("reassignment needs somewhere to send it", async ({ page }) => {
    await signIn(page, USERS.admin);
    const refused = await callEdgeFunction(page, "data-center-assign", {
      action: "reassign",
      saleIds: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/toAgentId/);
  });

  test("moving nothing says so rather than reporting a move of zero", async ({ page }) => {
    await signIn(page, USERS.admin);
    const agents = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    const agent = (agents.body as { data: { agents: { agent_id: string }[] } }).data.agents[0];

    const nothing = await callEdgeFunction(page, "data-center-assign", {
      action: "reassign",
      toAgentId: agent.agent_id,
      saleIds: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(nothing.status).toBe(404);
    expect(JSON.stringify(nothing.body)).toMatch(/Nothing there to move/);
  });
});

test.describe("one number, several stoves", () => {
  test("the register is on the page and says what it is for", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Numbers with more than one stove" }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a number too short to match on is refused", async ({ page }) => {
    await signIn(page, USERS.admin);
    const { saleId } = await anySale(page);
    const refused = await callEdgeFunction(page, "data-center-write", {
      action: "record_shared_phone",
      saleId,
      phone: "0803",
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/too short/);
  });
});

test.describe("the outcomes and reasons that were removed", () => {
  test("doubtful verification is refused by the database", async ({ page }) => {
    await signIn(page, USERS.admin);
    const { saleId } = await anySale(page);

    /**
     * Asserted at the write endpoint, because a value the UI no longer offers
     * is only really gone when the thing behind the UI refuses it too. The
     * outcome list, the funnel view and the scorecard compute all dropped it
     * together; this is the one that would let it back in.
     */
    const refused = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId,
      // Inside `values`, which is where the endpoint looks. Sent at the top
      // level it was validated by nothing and answered 200, which said more
      // about the test than about the rule.
      values: { verification_outcome: "doubtful_verification" },
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/Unknown verification outcome/);
  });

  test("unreachable is an outcome an agent can actually set", async ({ page }) => {
    await signIn(page, USERS.admin);
    const { saleId } = await anySale(page);

    /**
     * It was in the check constraint, the queue's filters, the funnel's
     * unreachable_count and a scorecard column - and refused by the write
     * endpoint, so that column could only ever be zero and read as "we always
     * get through". Asserted here because a permanently empty metric is
     * indistinguishable from a true one until somebody tries to move it.
     */
    const ok = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId,
      values: { verification_outcome: "unreachable" },
    });
    expect(ok.status).toBe(200);

    // Put it back, so the next test reads the record the seed intended.
    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId,
      values: { verification_outcome: "not_verified" },
    });
  });

  test("a wrong name is no longer a reason to send a sale back to Sales", async ({ page }) => {
    await signIn(page, USERS.admin);

    // The agent corrects those on the call, so offering them as a reason sent
    // work back for something already fixed. Retired, not deleted: records
    // that used them keep their history.
    const schema = await callEdgeFunction(page, "data-center-write", {
      action: "form_schema",
    });
    const said = JSON.stringify(schema.body);
    expect(said).not.toMatch(/"Name is wrong"/);
    expect(said).not.toMatch(/"Address is wrong"/);
  });
});

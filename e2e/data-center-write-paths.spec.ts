import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The five new write paths, doing the thing rather than refusing to.
 *
 * Every one of these was proved once by a throwaway script and then guarded by
 * nothing. The spec that shipped alongside them asserted eight refusals and one
 * success, so the suite could go green with every happy path broken - which is
 * the shape of coverage that reads as thorough and defends nothing.
 *
 * These mutate real rows, so each test puts back what it moved. A suite that
 * only passes on a fresh database is a suite nobody runs twice.
 */

type Stove = { stove_id: string; sale_id: string | null; organization_id: string };

/** Two sales whose stoves came from the same partner - what a swap needs. */
async function samePartnerPair(page: Page) {
  const funnel = await callEdgeFunction(page, "data-center-read", {
    action: "transfer_funnel",
    limit: 50,
  });
  const orgs = (funnel.body as { data: { rows: { organization_id: string }[] } }).data.rows;

  for (const { organization_id } of orgs) {
    const detail = await callEdgeFunction(page, "data-center-read", {
      action: "digitisation_sheet",
      organizationId: organization_id,
    });
    const rows = (detail.body as {
      data: { rows: { stove_id: string; already_recorded: boolean }[] };
    }).data.rows;
    const sold = rows.filter((r) => r.already_recorded);
    const free = rows.filter((r) => !r.already_recorded);
    if (sold.length >= 2 && free.length >= 1) {
      return { sold, free, organizationId: organization_id };
    }
  }
  return null;
}

async function stoveOf(page: Page, stoveId: string) {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "stove_detail",
    stoveId,
  });
  return (r.body as { data: { stove: Record<string, unknown> } }).data.stove;
}

test.describe("the stove-ID rematch actually moves a record", () => {
  test("claiming a free stove moves the sale and releases the old one", async ({ page }) => {
    await signIn(page, USERS.admin);
    const pair = await samePartnerPair(page);
    test.skip(!pair, "the preview holds no partner with both a sold and a free stove");

    const from = pair!.sold[0].stove_id;
    const to = pair!.free[0].stove_id;
    const before = await stoveOf(page, from);
    const saleId = before.sale_id as string;

    const moved = await callEdgeFunction(page, "data-center-write", {
      action: "serial_rematch",
      saleId,
      confirmedSerial: to,
      note: "e2e: buyer read it off the label",
    });
    expect(moved.status).toBe(200);
    expect((moved.body as { data: { kind: string } }).data.kind).toBe("claimed_available");

    // The sale carries the new stove, the new stove carries the sale, and the
    // old one is back on the shelf. All three, because a rematch that moved
    // only the sale would leave stock lying about who owns what.
    const now = await stoveOf(page, to);
    expect(now.sale_id).toBe(saleId);
    expect(now.stock_status).toBe("sold");
    const released = await stoveOf(page, from);
    expect(released.sale_id).toBeNull();
    expect(released.stock_status).toBe("available");

    // Put it back.
    const undo = await callEdgeFunction(page, "data-center-write", {
      action: "serial_rematch",
      saleId,
      confirmedSerial: from,
      note: "e2e: restoring",
    });
    expect(undo.status).toBe(200);
  });

  test("a swap exchanges two sales and flags only the buyer who did not ask", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const pair = await samePartnerPair(page);
    test.skip(!pair, "the preview holds no partner with two sold stoves");

    const mine = pair!.sold[0].stove_id;
    const theirs = pair!.sold[1].stove_id;
    const a = await stoveOf(page, mine);
    const b = await stoveOf(page, theirs);
    const saleA = a.sale_id as string;
    const saleB = b.sale_id as string;

    const swapped = await callEdgeFunction(page, "data-center-write", {
      action: "serial_rematch",
      saleId: saleA,
      confirmedSerial: theirs,
    });
    expect(swapped.status).toBe(200);
    expect((swapped.body as { data: { kind: string } }).data.kind).toBe("swapped");

    // Both stock rows moved with the sales. Neither stove is owned twice,
    // which is the invariant an unguarded claim used to break.
    expect((await stoveOf(page, theirs)).sale_id).toBe(saleA);
    expect((await stoveOf(page, mine)).sale_id).toBe(saleB);

    /**
     * And the buyer who was moved without being asked is flagged. Nobody has
     * confirmed anything with them: their record now names a stove they have
     * never read out, on another customer's word.
     */
    const displaced = await callEdgeFunction(page, "data-center-write", {
      action: "call_record",
      saleId: saleB,
    });
    const record = (displaced.body as { data: { record: Record<string, unknown> } }).data.record;
    expect(record.serial_unconfirmed_at).not.toBeNull();
    expect(String(record.serial_unconfirmed_reason)).toContain(theirs);

    // The one who confirmed is not flagged - they told us themselves.
    const confirmer = await callEdgeFunction(page, "data-center-write", {
      action: "call_record",
      saleId: saleA,
    });
    expect(
      (confirmer.body as { data: { record: Record<string, unknown> } }).data.record
        .serial_unconfirmed_at,
    ).toBeNull();

    // Swap them back.
    const undo = await callEdgeFunction(page, "data-center-write", {
      action: "serial_rematch",
      saleId: saleA,
      confirmedSerial: mine,
    });
    expect(undo.status).toBe(200);
  });
});

test.describe("reassignment moves work between agents", () => {
  test("a record moves to another agent and can be moved back", async ({ page }) => {
    await signIn(page, USERS.admin);

    const log = await callEdgeFunction(page, "data-center-read", {
      action: "assignment_log",
      limit: 50,
      filters: { batchState: "open" },
    });
    const open = (log.body as {
      data: { rows: { sale_id: string; agent_id: string | null }[] };
    }).data.rows.filter((r) => r.agent_id);
    test.skip(open.length === 0, "nothing is assigned on the preview to move");

    const item = open[0];
    const agents = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    const enabled = (agents.body as {
      data: { agents: { agent_id: string; is_enabled: boolean }[] };
    }).data.agents.filter((a) => a.is_enabled);
    const other = enabled.find((a) => a.agent_id !== item.agent_id);
    test.skip(!other, "the preview has only one enabled agent, so there is nowhere to move it");

    const moved = await callEdgeFunction(page, "data-center-assign", {
      action: "reassign",
      toAgentId: other!.agent_id,
      saleIds: [item.sale_id],
    });
    expect(moved.status).toBe(200);
    const result = (moved.body as { data: { moved: number; toAgentId: string } }).data;
    expect(result.moved).toBe(1);
    expect(result.toAgentId).toBe(other!.agent_id);

    // It is genuinely theirs now, not merely reported as moved.
    const after = await callEdgeFunction(page, "data-center-read", {
      action: "assignment_log",
      limit: 50,
      filters: { agentId: other!.agent_id, batchState: "open" },
    });
    const theirs = (after.body as { data: { rows: { sale_id: string }[] } }).data.rows;
    expect(theirs.map((r) => r.sale_id)).toContain(item.sale_id);

    // Back where it came from.
    const back = await callEdgeFunction(page, "data-center-assign", {
      action: "reassign",
      toAgentId: item.agent_id!,
      saleIds: [item.sale_id],
    });
    expect(back.status).toBe(200);
  });
});

test.describe("a number carrying more than one stove is registered", () => {
  test("recording a shared phone puts every stove on it into the register", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const queue = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
    });
    const row = (queue.body as {
      data: { rows: { sale_id: string; primary_phone: string }[] };
    }).data.rows[0];
    test.skip(!row?.primary_phone, "no record with a phone number on the preview");

    const recorded = await callEdgeFunction(page, "data-center-write", {
      action: "record_shared_phone",
      saleId: row.sale_id,
      phone: row.primary_phone,
      note: "e2e: household check",
    });
    expect(recorded.status).toBe(200);

    const data = (recorded.body as {
      data: { phoneTail: string; stoves: { sale_id: string }[] };
    }).data;
    // The tail is the comparison key everywhere: last ten digits, country code
    // discarded, so the register groups the way create-sale matches.
    expect(data.phoneTail).toBe(row.primary_phone.replace(/\D+/g, "").slice(-10));
    expect(data.stoves.map((s) => s.sale_id)).toContain(row.sale_id);
  });
});

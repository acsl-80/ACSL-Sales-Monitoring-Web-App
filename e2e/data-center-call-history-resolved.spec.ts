import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Nothing lost: the call history counts for the person who made the call
 * (Phase 28, S1b; D47, D48).
 *
 * A paper call sheet named its agent as a registry value. Linked to a login,
 * every attempt carrying that tag, and every untagged attempt on a record
 * that carries it, counts for that login on the board, the agent page and the
 * feed; an untagged sheet call counts for nobody rather than for the importer.
 * The repair's backup table holds exactly what it changed. Settings offers
 * the link and takes it back.
 *
 * Red on main: no source column, no links table, no resolved view, no
 * agent_links action, no Sheet names card.
 */

test.describe.configure({ timeout: 180_000 });

const SHEET_NOTE = "Imported from the call-centre sheet";

async function userId(email: string): Promise<string> {
  const [r] = await branchSql<{ id: string }>(`select id::text from public.profiles where email = '${email}' limit 1`);
  return r.id;
}

/** A sale this year with a call record and no attempt yet, arranged if needed. */
async function saleWithRecord(page: Page): Promise<{ sale_id: string }> {
  const [row] = await branchSql<{ sale_id: string; has: boolean }>(
    `select c.sale_id::text, c.has_call_record as has from data_center.v_call_center c
      where c.is_archived is not true and coalesce(c.attempt_count, 0) = 0
      order by c.has_call_record desc, c.sales_date desc limit 1`,
  );
  expect(row, "a record to arrange").toBeTruthy();
  if (!row.has) {
    const r = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: row.sale_id, values: { other_comments: "e2e arranged" },
    });
    expect(r.status).toBe(200);
  }
  return { sale_id: row.sale_id };
}

test("a tagged sheet attempt counts for the linked login, an untagged one on the same record too, and an untagged sheet call for nobody", async ({ page }) => {
  await signIn(page, USERS.admin);
  const me = await userId(USERS.admin);
  const other = await userId(USERS.callCentre);
  const { sale_id } = await saleWithRecord(page);
  const [tag] = await branchSql<{ id: string; value: string }>(
    `select id::text, value from data_center.option_values where list_key = 'agent_name' order by sort_order limit 1`,
  );

  // Link the sheet name to the other login through the real action.
  const linked = await callEdgeFunction(page, "data-center-admin", { action: "agent_link_set", agentKey: tag.value, userId: other });
  expect(linked.status, JSON.stringify(linked.body).slice(0, 200)).toBe(200);

  const ids: number[] = [];
  try {
    // Three sheet attempts written by me (the importer): one tagged, one untagged
    // on the same record (the record carries the tag), and one untagged on a
    // record with no tag at all.
    const rows = await branchSql<{ id: number }>(
      `with a as (
         insert into data_center.call_attempts (sale_id, attempt_no, attempted_at, agent_id, note, created_by, source)
         values ('${sale_id}', 1, now() - interval '1 hour', '${tag.id}', '${SHEET_NOTE}', '${me}', 'sheet'),
                ('${sale_id}', 2, now() - interval '30 minutes', null, '${SHEET_NOTE}', '${me}', 'sheet')
         returning id)
       select id from a`,
    );
    ids.push(...rows.map((r) => Number(r.id)));
    await branchSql(`update data_center.call_records set call_agent_id = '${tag.id}' where sale_id = '${sale_id}'`);

    const resolved = await branchSql<{ attempt_no: number; agent_user_id: string | null }>(
      `select attempt_no, agent_user_id::text from data_center.v_call_attempts_resolved where sale_id = '${sale_id}' order by attempt_no`,
    );
    expect(resolved.map((r) => r.agent_user_id)).toEqual([other, other]);

    // The record's tag gone, the untagged sheet attempt counts for nobody; the tagged one still for the link.
    await branchSql(`update data_center.call_records set call_agent_id = null where sale_id = '${sale_id}'`);
    const again = await branchSql<{ attempt_no: number; agent_user_id: string | null }>(
      `select attempt_no, agent_user_id::text from data_center.v_call_attempts_resolved where sale_id = '${sale_id}' order by attempt_no`,
    );
    expect(again.map((r) => r.agent_user_id)).toEqual([other, null]);

    // The board's marks for today put the tagged call under the other login, not under me.
    const board = await callEdgeFunction(page, "data-center-assign", { action: "board" });
    expect(board.status).toBe(200);
    const agents = (board.body as { data: { agents: { agent_id?: string; marks: { sale_id: string }[]; called?: number }[] } }).data.agents;
    const carrier = agents.find((a) => a.marks.some((m) => m.sale_id === sale_id));
    expect(carrier, "an agent row carrying the mark").toBeTruthy();
    expect(carrier!.agent_id, "the mark sits under the linked login, not the importer").toBe(other);
    const feed = await callEdgeFunction(page, "data-center-assign", { action: "activity", agentId: other, limit: 50 });
    expect(feed.status).toBe(200);
    const events = (feed.body as { data: { rows: { kind: string; sale_id: string | null }[] } }).data.rows;
    expect(events.some((e) => e.kind === "call" && e.sale_id === sale_id)).toBe(true);
  } finally {
    if (ids.length) await branchSql(`delete from data_center.call_attempts where id in (${ids.join(",")})`);
    await branchSql(`update data_center.call_records set call_agent_id = null where sale_id = '${sale_id}'`);
    await callEdgeFunction(page, "data-center-admin", { action: "agent_link_set", agentKey: tag.value, userId: null });
  }
});

test("the repair's backup holds what it changed, and the source column is filled", async () => {
  const [src] = await branchSql<{ unsourced: number; sheet: number; form: number; reconciled: number }>(
    `select count(*) filter (where source is null)::int as unsourced,
            count(*) filter (where source = 'sheet')::int as sheet,
            count(*) filter (where source = 'form')::int as form,
            count(*) filter (where source = 'reconciled')::int as reconciled
       from data_center.call_attempts`,
  );
  expect(Number(src.unsourced)).toBe(0);
  const [b] = await branchSql<{ inserted: number; matched: number; set: number; landed: number }>(
    `select count(*) filter (where inserted)::int as inserted,
            (select count(*) from data_center.call_history_repair_20260911 r join data_center.call_attempts a on a.id = r.attempt_id where r.inserted and a.source = 'reconciled')::int as matched,
            count(*) filter (where not inserted)::int as set,
            (select count(*) from data_center.call_history_repair_20260911 r join data_center.call_attempts a on a.id = r.attempt_id where not r.inserted and a.outcome_id is not null)::int as landed
       from data_center.call_history_repair_20260911`,
  );
  expect(Number(b.matched)).toBe(Number(b.inserted));
  expect(Number(b.landed)).toBe(Number(b.set));
  expect(Number(src.reconciled)).toBe(Number(b.inserted));
  // No concluded record is left without a call, and none with calls but no outcome.
  const [left] = await branchSql<{ no_call: number; no_outcome: number }>(
    `select count(*) filter (where coalesce(cr.attempt_count, 0) = 0)::int as no_call,
            count(*) filter (where coalesce(cr.attempt_count, 0) > 0
              and not exists (select 1 from data_center.call_attempts a where a.sale_id = cr.sale_id and a.outcome_id is not null))::int as no_outcome
       from data_center.call_records cr
      where cr.verification_outcome in ('fully_verified', 'partially_verified', 'unreachable')`,
  );
  expect(Number(left.no_call)).toBe(0);
  expect(Number(left.no_outcome)).toBe(0);
});

test("Settings offers the sheet names, links one and takes it back; a viewer cannot", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/settings");
  const card = page.locator("[data-sheet-names]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByRole("heading", { name: "Sheet names" })).toBeVisible();
  const [tag] = await branchSql<{ value: string; label: string }>(
    `select value, label from data_center.option_values where list_key = 'agent_name' order by sort_order desc limit 1`,
  );
  const row = card.locator(`[data-sheet-name="${tag.value}"]`).first();
  await expect(row).toBeVisible();
  // Mark it as not a person and back, through the card.
  await row.getByRole("button", { name: "Not a person" }).click();
  await expect(row.getByText("not a person")).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Back in the list" }).click();
  await expect(row.getByRole("combobox", { name: `Login for ${tag.label}` })).toBeVisible({ timeout: 15_000 });

  // The read is open to the module; the write needs assignment.manage.
  const refused = await callEdgeFunction(page, "data-center-admin", { action: "agent_link_set", agentKey: tag.value, userId: null });
  expect(refused.status).toBe(200);
  await signIn(page, USERS.callCentre);
  const denied = await callEdgeFunction(page, "data-center-admin", { action: "agent_link_set", agentKey: tag.value, noAccount: true });
  expect(denied.status).toBe(403);
});

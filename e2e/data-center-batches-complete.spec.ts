import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Slice 5 of the 2026-09-02 review: batches complete.
 *
 * assignment_batches.state could become 'completed' in one place only, inside
 * reassign, for a batch emptied by that reassignment. Nothing closed a batch
 * because its calls were finished. So My Work listed finished work for ever,
 * and capacity, which counts open batches against a cap of one, treated an
 * agent who had finished as full. On 2026-09-02 one agent sat in exactly that
 * state: 18 of 18 concluded, batch still open, nothing new arriving.
 *
 * This seeds a two-record batch for the call-centre user, concludes both
 * records through the editor (one verified, one unreachable, since both are
 * conclusions), and reads the batch back. Against the old code it is still
 * open. Against the new code it is completed, and the agent's own queue
 * returns it marked finished rather than as open work.
 */

type Seed = {
  agent_id: string;
  batch_id: string;
  parked_item_ids: string[];
  sales: { id: string; end_user_name: string }[];
};
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

async function seedBatch(): Promise<Seed> {
  const [agent] = await branchSql<{ id: string }>(
    `select id::text from public.profiles where email = '${USERS.callCentre}' limit 1`,
  );
  expect(agent, "the call-centre user is not in the seed").toBeTruthy();
  // Two live sales at one partner. The suite's own setup has already assigned
  // every seeded sale, so their current items are parked (deactivated) for the
  // length of this test and put back afterwards.
  const sales = await branchSql<{ id: string; end_user_name: string; organization_id: string }>(
    `with candidates as (
       select s.id, s.end_user_name, s.organization_id,
              count(*) over (partition by s.organization_id) as per_org
         from public.sales s
        where s.is_archived is not true and s.end_user_name is not null
          and s.organization_id is not null
     )
     select id::text, end_user_name, organization_id::text
       from candidates where per_org >= 2
      order by organization_id, id limit 2`,
  );
  expect(sales.length, "the seed has no partner with two live sales").toBe(2);
  expect(sales[0].organization_id).toBe(sales[1].organization_id);
  const parked = await branchSql<{ id: string }>(
    `update data_center.assignment_items set is_active = false
      where is_active and sale_id in ('${sales[0].id}', '${sales[1].id}')
      returning id::text`,
  );
  for (const s of sales) {
    await branchSql(
      `insert into data_center.call_records (sale_id, created_by) values ('${s.id}', '${agent.id}')
       on conflict (sale_id) do update set verification_outcome = 'not_verified'`,
    );
  }
  const [batch] = await branchSql<{ id: string }>(
    `insert into data_center.assignment_batches (organization_id, assigned_to, size, state)
     values ('${sales[0].organization_id}', '${agent.id}', 2, 'open') returning id::text`,
  );
  await branchSql(
    `insert into data_center.assignment_items (batch_id, sale_id, position)
     values ('${batch.id}', '${sales[0].id}', 1), ('${batch.id}', '${sales[1].id}', 2)`,
  );
  return { agent_id: agent.id, batch_id: batch.id, parked_item_ids: parked.map((p) => p.id), sales };
}

async function batchState(batchId: string) {
  const [r] = await branchSql<{ state: string; completed_at: string | null }>(
    `select state, completed_at::text from data_center.assignment_batches where id = '${batchId}'`,
  );
  return r;
}

async function conclude(page: Page, name: string, outcomeLabel: string) {
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 20_000 });
  const first = name.trim().split(/\s+/)[0];
  await page
    .getByRole("button", { name: new RegExp(`^Open call record for .*${first}`, "i") })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Verification outcome" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: outcomeLabel, exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
}

test("a batch whose records are all concluded closes itself and leaves the agent's open work", async ({
  page,
}) => {
  const seed = await seedBatch();
  expect(SAFE_ID.test(seed.batch_id)).toBe(true);
  try {
    await signIn(page, USERS.callCentre);
    await conclude(page, seed.sales[0].end_user_name, "Verified");
    expect((await batchState(seed.batch_id)).state, "one of two concluded: still open").toBe("open");
    await conclude(page, seed.sales[1].end_user_name, "Unreachable");

    // The whole point. Old code: nothing closes a batch, so it stays open.
    await expect
      .poll(async () => (await batchState(seed.batch_id)).state, {
        timeout: 20_000,
        message: "with every record concluded the batch should be completed",
      })
      .toBe("completed");
    expect((await batchState(seed.batch_id)).completed_at, "completed_at should be stamped").toBeTruthy();

    // The agent's own queue returns it as finished, not as open work.
    const mine = await callEdgeFunction(page, "data-center-assign", { action: "my_batches" });
    const rows =
      (mine.body as { data?: { items?: { batch_id: string; batch_state?: string }[] } })?.data?.items ??
      (mine.body as { data?: { batches?: { batch_id: string; batch_state?: string }[] } })?.data?.batches ??
      [];
    const ofBatch = rows.filter((r) => r.batch_id === seed.batch_id);
    expect(ofBatch.length, "the finished batch should still be returned for the last seven days").toBeGreaterThan(0);
    expect(
      ofBatch.every((r) => r.batch_state === "completed"),
      "every row of the finished batch should be marked completed",
    ).toBe(true);

    // And capacity is free again: no open batch counts against this agent.
    const [open] = await branchSql<{ n: number }>(
      `select count(*)::int n from data_center.assignment_batches where assigned_to = '${seed.agent_id}' and state = 'open'`,
    );
    expect(open.n, "a finished batch must not count against the agent's capacity").toBe(0);
  } finally {
    await branchSql(`delete from data_center.assignment_batches where id = '${seed.batch_id}'`);
    for (const s of seed.sales) {
      await branchSql(
        `update data_center.call_records set verification_outcome = 'not_verified' where sale_id = '${s.id}'`,
      );
    }
    if (seed.parked_item_ids.length) {
      await branchSql(
        `update data_center.assignment_items set is_active = true
          where id in (${seed.parked_item_ids.map((id) => `'${id}'`).join(",")})`,
      );
    }
  }
});

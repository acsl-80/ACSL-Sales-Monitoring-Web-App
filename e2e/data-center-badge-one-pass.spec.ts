import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 32, slice 1 (D58): the corrections badge counts in one pass.
 *
 * `work_waiting` asked `v_corrections` six separate times, twice for the same
 * count. On production it counted 113 rows in 12,038 ms and was 65% of the
 * whole database's time, because the control centre polls it every sixty
 * seconds for every manager with the page open. One pass over the same view:
 * 3,898 ms.
 *
 * Nothing it reports may change. That is the whole contract, so this spec
 * arranges a correction for every count, including the states and the routing
 * production has none of, and asserts the endpoint agrees with the old
 * definition computed independently over the view.
 *
 * Each count is also shown to have been exercised, so an agreement of zeros
 * cannot pass for a proof. That guard is the spec's own weak point if it is
 * left to chance, so the unrouted fixture picks a sale whose rep genuinely has
 * no account rather than hoping one turns up.
 */
test.describe.configure({ timeout: 240_000 });

const TAG = "BADGE1PASS";

type Waiting = {
  mineOpen: number; mineFixed: number; review: number | null;
  openAll: number | null; fixedAll: number | null;
  unconfirmed: number | null; unroutedReps: number | null;
};

/** The old definition, asked exactly as it was before this slice. */
async function oracle(userId: string) {
  const [row] = await branchSql<Record<string, number>>(
    `select
       (select count(*)::int from data_center.v_corrections c
         where c.state = 'open' and c.is_archived is not true
           and (c.current_rep_user_id = '${userId}' or c.assigned_to = '${userId}')) as mine_open,
       (select count(*)::int from data_center.v_corrections c
         where c.state = 'fixed' and c.fixed_by = '${userId}' and c.is_archived is not true) as mine_fixed,
       (select count(*)::int from data_center.v_corrections c
         where c.state = 'fixed' and c.is_archived is not true) as review,
       (select count(*)::int from data_center.v_corrections c
         where c.state = 'open' and c.is_archived is not true) as open_all,
       (select count(*)::int from data_center.v_corrections c
         where c.state = 'fixed' and c.is_archived is not true) as fixed_all,
       (select count(*)::int from data_center.call_records cr
         join public.sales s on s.id = cr.sale_id
         where cr.serial_unconfirmed_at is not null and s.is_archived is not true) as unconfirmed,
       (select count(distinct coalesce(c.sales_rep, ''))::int from data_center.v_corrections c
         where c.state = 'open' and c.current_rep_user_id is null
           and c.is_archived is not true and c.sales_rep is not null) as unrouted`,
  );
  return row;
}

async function clean() {
  await branchSql(`delete from data_center.corrections where note like '${TAG}%'`).catch(() => {});
}

test("the badge counts in one pass and reports exactly what the old shape did", async ({ page }) => {
  await signIn(page, USERS.admin);
  const [me] = await branchSql<{ id: string }>(
    `select id::text from public.profiles where email = '${USERS.admin}'`,
  );
  const [other] = await branchSql<{ id: string }>(
    `select id::text from public.profiles where email = '${USERS.dataManager}'`,
  );
  expect(me?.id && other?.id, "two accounts to attribute work to").toBeTruthy();

  await clean();

  /*
   * One sale whose transfer names a rep nobody has an account for, so the
   * correction opened on it lands in "unrouted" by the view's own rule rather
   * than by luck, and three more for the other shapes.
   */
  const [unrouted] = await branchSql<{ id: string }>(
    `select s.id::text
       from public.sales s
       join public.stove_ids_base sb on sb.sale_id = s.id
       join public.stove_transfer_history h on h.transaction_id = sb.sales_reference
      where s.is_archived is not true
        and h.sales_rep is not null
        and not exists (select 1 from data_center.sales_rep_accounts ra
                         where ra.rep_key = lower(btrim(h.sales_rep)))
        and not exists (select 1 from data_center.corrections x where x.sale_id = s.id)
      order by s.created_at desc limit 1`,
  );
  expect(unrouted?.id, "a sale whose transfer rep has no account").toBeTruthy();

  const rest = await branchSql<{ id: string }>(
    `select s.id::text
       from public.sales s
       join public.stove_ids_base sb on sb.sale_id = s.id
      where s.is_archived is not true
        and s.id <> '${unrouted.id}'
        and not exists (select 1 from data_center.corrections x where x.sale_id = s.id)
      order by s.created_at desc limit 3`,
  );
  expect(rest.length, "three more free live sales with stock").toBe(3);

  // The unconfirmed count is about serials, not corrections, and the sandbox
  // carries none. Raise one so the guard below means something, and put it
  // back afterwards.
  const [withCall] = await branchSql<{ sale_id: string }>(
    `select cr.sale_id::text from data_center.call_records cr
       join public.sales s on s.id = cr.sale_id
      where s.is_archived is not true and cr.serial_unconfirmed_at is null
      limit 1`,
  );

  try {
    if (withCall?.sale_id) {
      await branchSql(
        `update data_center.call_records set serial_unconfirmed_at = now()
          where sale_id = '${withCall.sale_id}'`,
      );
    }
    /*
     * One of each shape the badge counts, including the two states production
     * holds none of:
     *   open, assigned to me            -> mine_open
     *   open, rep has no account        -> unrouted, open_all
     *   fixed by me                     -> mine_fixed, review, fixed_all
     *   fixed by somebody else          -> review, fixed_all
     */
    await branchSql(
      `insert into data_center.corrections (sale_id, seq, state, note, opened_at, assigned_to)
       values ('${rest[0].id}', 1, 'open', '${TAG} assigned to me', now(), '${me.id}')`,
    );
    await branchSql(
      `insert into data_center.corrections (sale_id, seq, state, note, opened_at)
       values ('${unrouted.id}', 1, 'open', '${TAG} routed to nobody', now())`,
    );
    await branchSql(
      `insert into data_center.corrections (sale_id, seq, state, note, opened_at, fixed_at, fixed_by)
       values ('${rest[1].id}', 1, 'fixed', '${TAG} fixed by me', now(), now(), '${me.id}')`,
    );
    await branchSql(
      `insert into data_center.corrections (sale_id, seq, state, note, opened_at, fixed_at, fixed_by)
       values ('${rest[2].id}', 1, 'fixed', '${TAG} fixed by another', now(), now(), '${other.id}')`,
    );

    const want = await oracle(me.id);
    const r = await callEdgeFunction(page, "data-center-corrections", { action: "work_waiting" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const got = (r.body as { data: Waiting }).data;

    // Every count the badge shows, against the definition it replaces.
    expect(got.mineOpen, "mine open").toBe(Number(want.mine_open));
    expect(got.mineFixed, "mine fixed").toBe(Number(want.mine_fixed));
    expect(got.review, "waiting for review").toBe(Number(want.review));
    expect(got.openAll, "open everywhere").toBe(Number(want.open_all));
    expect(got.fixedAll, "fixed everywhere").toBe(Number(want.fixed_all));
    expect(got.unconfirmed, "serials unconfirmed").toBe(Number(want.unconfirmed));
    expect(got.unroutedReps, "reps with nobody to route to").toBe(Number(want.unrouted));

    // And every one of them was actually exercised, so an agreement of zeros
    // cannot pass for a proof.
    expect(got.openAll ?? 0, "the open count saw the arranged rows").toBeGreaterThanOrEqual(2);
    expect(got.review ?? 0, "the fixed count saw the arranged rows").toBeGreaterThanOrEqual(2);
    expect(got.mineOpen, "one open correction is mine").toBeGreaterThanOrEqual(1);
    expect(got.mineFixed, "one fixed correction is mine").toBeGreaterThanOrEqual(1);
    expect(got.unroutedReps ?? 0, "one correction is routed to nobody").toBeGreaterThanOrEqual(1);
    if (withCall?.sale_id) {
      expect(got.unconfirmed ?? 0, "one serial is unconfirmed").toBeGreaterThanOrEqual(1);
    }
  } finally {
    await clean();
    if (withCall?.sale_id) {
      await branchSql(
        `update data_center.call_records set serial_unconfirmed_at = null
          where sale_id = '${withCall.sale_id}'`,
      ).catch(() => {});
    }
  }
});

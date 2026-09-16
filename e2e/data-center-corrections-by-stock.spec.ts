import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 32, slice 2 (D59): a correction finds its transfer without reading
 * every transfer.
 *
 * `v_corrections` resolved each correction's transfer through a lateral over
 * `v_transfer_stoves`, which expands every transfer's `stove_ids` JSON into one
 * row per stove and then matches the serial as text. On production that is
 * 23,069 rows re-expanded once per correction, and it is the four seconds slice
 * 1 could not reach. The transfer now comes from the stove's own stock row,
 * which is an index lookup.
 *
 * The answer must not move. This spec holds the invariant directly: for every
 * correction, what the view says about its transfer equals what the old JSON
 * route says, column by column. It is written to keep holding, so it stays
 * useful long after the change that prompted it.
 */
test.describe.configure({ timeout: 240_000 });

const TAG = "BYSTOCK";

async function clean() {
  await branchSql(`delete from data_center.corrections where note like '${TAG}%'`).catch(() => {});
}

test("the view names the same transfer as expanding every transfer would", async () => {
  await clean();
  // Arrange a correction on every live sale that has stock and none yet, so the
  // comparison runs over more than whatever happens to be open today.
  const sales = await branchSql<{ id: string }>(
    `select s.id::text from public.sales s
       join public.stove_ids_base sb on sb.sale_id = s.id
      where s.is_archived is not true
        and not exists (select 1 from data_center.corrections x where x.sale_id = s.id)
      order by s.created_at desc limit 6`,
  );
  expect(sales.length, "live sales with stock to compare over").toBeGreaterThanOrEqual(2);
  try {
    for (const [i, s] of sales.entries()) {
      await branchSql(
        `insert into data_center.corrections (sale_id, seq, state, note, opened_at)
         values ('${s.id}', 1, 'open', '${TAG} ${i}', now())`,
      );
    }

    const [row] = await branchSql<{ compared: number; identical: number; differ: number; sample: string | null }>(
      `with per as (
         select c.id,
           (select jsonb_build_object('t', f.transfer_id, 'x', f.transaction_id,
                                      'p', f.partner_name, 'r', f.sales_rep, 'o', f.organization_id)
              from data_center.v_transfer_stoves b
              join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
             where b.stove_id = upper(btrim(s.stove_serial_no))
             order by f.transfer_date desc nulls last limit 1) as by_json,
           (select jsonb_build_object('t', v.transfer_reference is not null, 'x', v.transfer_reference,
                                      'p', v.partner_name, 'r', v.sales_rep, 'o', v.organization_id)
              from data_center.v_corrections v where v.id = c.id) as by_view
           from data_center.corrections c
           join public.sales s on s.id = c.sale_id
       ),
       shaped as (
         select id,
                case when by_json is null then null
                     else jsonb_build_object('x', by_json ->> 'x', 'p', by_json ->> 'p',
                                             'r', by_json ->> 'r', 'o', by_json ->> 'o') end as a,
                case when by_view ->> 'x' is null and by_view ->> 'p' is null then null
                     else jsonb_build_object('x', by_view ->> 'x', 'p', by_view ->> 'p',
                                             'r', by_view ->> 'r', 'o', by_view ->> 'o') end as b
           from per
       )
       select count(*)::int as compared,
              count(*) filter (where a is not distinct from b)::int as identical,
              count(*) filter (where a is distinct from b)::int as differ,
              (select left(coalesce(a::text,'null') || ' VS ' || coalesce(b::text,'null'), 200)
                 from shaped where a is distinct from b limit 1) as sample
         from shaped`,
    );

    expect(Number(row.compared), "corrections compared").toBeGreaterThanOrEqual(2);
    expect(Number(row.differ), `the two routes disagree: ${row.sample ?? ""}`).toBe(0);
    expect(Number(row.identical)).toBe(Number(row.compared));
  } finally {
    await clean();
  }
});

test("the corrections list and the badge still answer, and the badge is quick", async ({ page }) => {
  await signIn(page, USERS.admin);
  const started = Date.now();
  const badge = await callEdgeFunction(page, "data-center-corrections", { action: "work_waiting" });
  const took = Date.now() - started;
  expect(badge.status, JSON.stringify(badge.body)).toBe(200);

  const list = await callEdgeFunction(page, "data-center-corrections", { action: "list", state: "open" });
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  const rows = (list.body as { data: { rows: { transfer_reference: string | null }[] } }).data.rows;
  expect(Array.isArray(rows), "the list still answers with rows").toBe(true);

  /*
   * A ceiling, not a benchmark. The badge took twelve seconds on production
   * before slice 1 and four after it; anything near those means the expansion
   * is back. The sandbox is small, so this is deliberately loose: it catches a
   * regression of that size and nothing subtler.
   */
  expect(took, `the badge answered in ${took} ms`).toBeLessThan(8000);
});

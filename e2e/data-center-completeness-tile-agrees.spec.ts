import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction, commitAndDrain } from "./helpers";

/**
 * Completeness said plainly.
 *
 * A sale committed through a receipt batch counts as complete without a drawn
 * signature, because the batch asserted the paper agreement; the dashboard no
 * longer alarms about the sales app's rule and instead names what is missing;
 * the Missing filter narrows the records table to the SQL oracle; the metric
 * carries one row per part of the rule.
 *
 * Red on main: the predicate demands a signature, the alarm is on the page,
 * missingField is not a filter and the metric does not exist.
 */

test.describe.configure({ timeout: 240_000 });

const SIX_PRESENT = `
  nullif(trim(coalesce(s.transaction_id, '')), '') is not null
  and nullif(trim(coalesce(s.stove_serial_no, '')), '') is not null
  and nullif(trim(coalesce(s.end_user_name, '')), '') is not null
  and nullif(trim(coalesce(s.phone, '')), '') is not null
  and s.amount is not null and s.address_id is not null`;

/** A live sale with the six fields, no signature, committed through a paper batch. */
async function paperSale(): Promise<string | null> {
  const [row] = await branchSql<{ id: string }>(
    `select s.id::text from public.sales s
      where s.is_archived is not true
        and (s.signature is null or s.signature = '')
        and ${SIX_PRESENT}
        and exists (select 1 from data_center.import_rows r
                      join data_center.import_batches b on b.id = r.batch_id
                     where r.sale_id = s.id and b.state = 'committed'
                       and b.source in ('receipt', 'workbench', 'manual', 'field'))
      order by s.created_at desc limit 1`,
  );
  return row?.id ?? null;
}

async function requiredFields(): Promise<string[]> {
  const [row] = await branchSql<{ fields: string[] }>(
    `select array(select jsonb_array_elements_text(value)) as fields
       from data_center.workflow_config where key = 'completeness_required_fields'`,
  );
  return row?.fields ?? [];
}

async function missingCount(field: string): Promise<number> {
  const [pred] = await branchSql<{ sql: string }>(
    `select data_center.missing_predicate('${field}', 's') as sql`,
  );
  const [n] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales s where s.is_archived is not true and (${pred.sql})`,
  );
  return Number(n.n);
}

/** A partner seeded with free stoves on every preview branch. */
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";

/**
 * A paper-committed sale, arranged through the import function when the
 * branch has none: a fresh branch carries seeded sales and no receipt batch,
 * and a test that skips there proves nothing about the rule.
 */
async function arrangePaperSale(page: Page, marker: string): Promise<string> {
  const stoves = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves", organizationId: TWIN_A, limit: 100,
  });
  const free = ((stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })
    .data?.stoves ?? []).find((s) => !s.sale_id)?.stove_id;
  expect(free, "a free stove to digitise a receipt for").toBeTruthy();

  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename: `${marker}.csv`,
    rows: [{
      sales_model: "Amina Model",
      stove_serial_no: free,
      first_name: "Paper",
      last_name: "Receipt",
      phone: "08012345699",
      sales_date: "2026-01-04",
      amount: "25000",
      state: "Kogi",
      lga: "Isanlu",
      address: `${marker} Paper Road`,
    }],
    confirmDuplicate: true,
  });
  expect(staged.status, JSON.stringify(staged.body)).toBe(200);
  const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
  const validated = await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
  expect(validated.status, JSON.stringify(validated.body)).toBe(200);
  const drained = await commitAndDrain(page, batchId);
  expect(drained.state, JSON.stringify(drained)).toBe("committed");

  const [row] = await branchSql<{ id: string }>(
    `select r.sale_id::text as id from data_center.import_rows r
      where r.batch_id = '${batchId}' and r.sale_id is not null limit 1`,
  );
  expect(row?.id, "the receipt became a sale").toBeTruthy();
  return row.id;
}

test("a sale committed through a paper batch is complete without a drawn signature", async ({ page }, testInfo) => {
  await signIn(page, USERS.admin);
  const id = (await paperSale()) ?? (await arrangePaperSale(page, `paper${testInfo.workerIndex}-${Date.now()}`));

  const [six] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales s where s.id = '${id}' and ${SIX_PRESENT}
        and (s.signature is null or s.signature = '')`,
  );
  expect(Number(six.n), "the arranged sale carries the six fields and no signature").toBe(1);

  const [pred] = await branchSql<{ sql: string }>(`select data_center.completeness_predicate('s') as sql`);
  const [hit] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales s where s.id = '${id}' and (${pred.sql})`,
  );
  expect(Number(hit.n), "the paper agreement is the evidence").toBe(1);

  // The batch says so itself.
  const [b] = await branchSql<{ asserted: boolean }>(
    `select bool_or(b.paper_agreement_asserted) as asserted
       from data_center.import_rows r join data_center.import_batches b on b.id = r.batch_id
      where r.sale_id = '${id}' and b.state = 'committed'`,
  );
  expect(b.asserted).toBe(true);

  // An evidence kind the module does not know is refused, not skipped.
  const [before] = await branchSql<{ value: string }>(
    `select value::text from data_center.workflow_config where key = 'completeness_evidence_any_of'`,
  );
  try {
    await branchSql(
      `update data_center.workflow_config set value = '[{"kind": "drop_table"}]'::jsonb
        where key = 'completeness_evidence_any_of'`,
    );
    const refused = await branchSql(`select data_center.completeness_predicate('s')`).catch((e: Error) => e);
    expect(refused).toBeInstanceOf(Error);
  } finally {
    await branchSql(
      `update data_center.workflow_config set value = '${before.value.replace(/'/g, "''")}'::jsonb
        where key = 'completeness_evidence_any_of'`,
    );
  }
});

test("the dashboard names what is missing instead of alarming about the sales app's rule", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/dashboard");
  await expect(page.getByRole("heading", { name: "Sold" }).or(page.getByText("Dashboards"))).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/complete by this module's rule and/)).toHaveCount(0);

  const strip = page.getByRole("region", { name: "What is missing" });
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(strip.getByText(/every required field is present/)).toBeVisible();
  const first = strip.getByRole("link").first();
  await expect(first).toHaveAttribute("href", /missingField=/);
  // The chip's count is over every live record, so its link opens the table
  // over every live record too: the two agree by construction.
  await expect(first).toHaveAttribute("href", /period=all/);
});

test("the Missing filter narrows the records table to the SQL oracle, from the URL", async ({ page }) => {
  const fields = await requiredFields();
  expect(fields.length, "a configured rule").toBeGreaterThan(0);
  let field: string | null = null;
  let expected = 0;
  for (const f of [...fields, "evidence"]) {
    const n = await missingCount(f);
    if (n > 0) { field = f; expected = n; break; }
  }
  // The seed carries sales from the sales app with neither a signature nor an
  // import row, so evidence is missing on every branch; a branch where it is
  // not is a broken arrangement, not a reason to skip.
  expect(field, "a part of the rule some live sale is missing").toBeTruthy();

  await signIn(page, USERS.admin);
  await page.goto(`/data-center/stove-records?missingField=${field}&period=all`);
  await expect(page.getByText(/Narrowed from the dashboard to/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^missing /)).toBeVisible();

  const count = page.getByText(/\d[\d,]*\+? records? · \d+ loaded/);
  await expect(count).toBeVisible({ timeout: 30_000 });
  const text = (await count.textContent()) ?? "";
  const shown = Number(text.match(/^([\d,]+)/)?.[1].replace(/,/g, ""));
  if (/^[\d,]+\+/.test(text)) expect(expected).toBeGreaterThan(shown);
  else expect(shown).toBe(expected);

  // The facet exists in the panel too, and reads back the URL.
  await page.getByRole("button", { name: /More filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Missing" })).toBeVisible();
});

test("the metric carries one row per part of the rule, each equal to its oracle", async ({ page }) => {
  await signIn(page, USERS.admin);
  const run = await callEdgeFunction(page, "data-center-compute", { action: "run" });
  expect(run.status, JSON.stringify(run.body)).toBe(200);

  const read = await callEdgeFunction(page, "data-center-read", { action: "dashboard" });
  expect(read.status).toBe(200);
  const metrics = (read.body as { data: { metrics: { metric_key: string; dimension: Record<string, string>; value_num: string | number }[] } }).data.metrics;
  const rows = metrics.filter((m) => m.metric_key === "sales.incomplete_by_missing");
  const fields = await requiredFields();
  for (const f of [...fields, "evidence"]) {
    const row = rows.find((r) => r.dimension.field === f);
    expect(row, `a row for ${f}`).toBeTruthy();
    expect(Number(row!.value_num), `the count for ${f}`).toBe(await missingCount(f));
  }
});

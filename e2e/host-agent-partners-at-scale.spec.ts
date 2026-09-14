import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, getEdgeFunction } from "./helpers";

/**
 * An agent whose coverage is every partner still gets their partners.
 *
 * On production most managers cover all 448 partners through their states.
 * The partners read put every covered organisation's id into one PostgREST
 * URL, which the hop from the function runtime to PostgREST refuses once the
 * list runs to hundreds, and the Sell Stove page reported "Internal server
 * error" for those accounts. This arranges 500 partners in one state, gives
 * the preview manager that state, and reads the partners.
 *
 * Red on main: the read answers 500.
 */

test.describe.configure({ timeout: 240_000 });

const MANAGER = "b0000000-0000-4000-8000-000000000002";
const TAG = "E2ESCALEORG";
const STATE = "Yobe";
const N = 500;

test.beforeAll(async () => {
  await branchSql(`delete from public.acsl_agent_states where agent_id = '${MANAGER}' and state = '${STATE}'`);
  await branchSql(`delete from public.organizations where partner_name like '${TAG} %'`);
  await branchSql(
    `insert into public.organizations (partner_name, state, branch, contact_person, contact_phone, address, partner_type)
     select '${TAG} ' || lpad(g::text, 3, '0'), '${STATE}', 'Branch ' || (g % 7), 'Scale Contact', '0803' || lpad(g::text, 7, '0'),
            g || ' Scale Road', 'partner'
       from generate_series(1, ${N}) as g`,
  );
  await branchSql(
    `insert into public.acsl_agent_states (agent_id, state, assigned_by) values ('${MANAGER}', '${STATE}', '${MANAGER}')`,
  );
});

test.afterAll(async () => {
  await branchSql(`delete from public.acsl_agent_states where agent_id = '${MANAGER}' and state = '${STATE}'`).catch(() => {});
  await branchSql(`delete from public.organizations where partner_name like '${TAG} %'`).catch(() => {});
});

test("a manager covering five hundred partners reads them all, with no server error", async ({ page }) => {
  await signIn(page, USERS.manager);
  const r = await getEdgeFunction(page, `super-admin-agents/${MANAGER}/organizations`);
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
  const rows = (r.body as { data?: { partner_name: string; source: string }[] }).data ?? [];
  const ours = rows.filter((o) => o.partner_name.startsWith(`${TAG} `));
  expect(ours.length, "every seeded partner arrives").toBe(N);
  expect(ours.every((o) => o.source === "state"), "resolved through the state").toBe(true);
});

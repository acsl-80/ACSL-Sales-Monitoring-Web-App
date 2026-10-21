import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, PREVIEW_PASSWORD, branchSql, callEdgeFunction } from "./helpers";

/**
 * Who may act.
 *
 * A disabled account is refused by sign-in and by every function that writes
 * a sale, even with a session it already holds. The shared-phone flag on
 * create-sale is honoured only for someone who may commit Data Center imports;
 * from anyone else it is ignored, so the same-buyer rule refuses as usual.
 */

const TAG = "E2EACT";
const spent = new Set<string>();
const madeTxn: string[] = [];

type Reply = { success?: boolean; message?: string; error?: string; code?: string };

async function ownOrgAndStove(email: string): Promise<{ org: string; name: string; stove: string }> {
  const [row] = await branchSql<{ org: string; name: string; stove: string | null }>(
    `select o.id::text as org, o.partner_name as name,
            (select s.stove_id from public.stove_ids_base s
              where s.organization_id = o.id and s.status = 'available' and s.sale_id is null
                ${spent.size ? `and s.stove_id not in (${[...spent].map((x) => `'${x}'`).join(",")})` : ""}
              order by s.stove_id limit 1) as stove
       from public.profiles p join public.organizations o on o.id = p.organization_id
      where p.email = '${email}'`,
  );
  expect(row?.stove, `a free stove for ${email}`).toBeTruthy();
  spent.add(row.stove!);
  return { org: row.org, name: row.name, stove: row.stove! };
}

function saleBody(o: { org: string; name: string; stove: string }, txn: string, phone: string, extra: Record<string, unknown> = {}) {
  madeTxn.push(txn);
  return {
    transactionId: txn,
    stoveSerialNo: o.stove,
    organizationId: o.org,
    partnerName: o.name,
    salesDate: "2026-10-20",
    amount: 25000,
    endUserFirstName: "Act",
    endUserSurname: "Check",
    phone,
    contactPerson: "Act Check",
    contactPhone: phone,
    salesAgentName: "Bala Sani",
    termsAccepted: {
      poaGoverned: true, monitoring: true, noResell: true,
      emissionReductions: true, noExport: true, demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Act Road`, state: "Kogi", city: "Lokoja" },
    ...extra,
  };
}

async function signInDirect(page: Page, identifier: string) {
  return page.evaluate(async ({ identifier, password }) => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
    const res = await fetch(`https://${ref}.supabase.co/functions/v1/login-with-credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { identifier, password: PREVIEW_PASSWORD });
}

test.afterAll(async () => {
  await branchSql(`update public.profiles set status = 'active' where email = '${USERS.agent}'`).catch(() => {});
  if (madeTxn.length) {
    const list = madeTxn.map((t) => `'${t}'`).join(",");
    const mine = `select id from public.sales where transaction_id in (${list})`;
    await branchSql(`update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`).catch(() => {});
    await branchSql(`delete from public.sales where id in (${mine})`).catch(() => {});
  }
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test("a disabled account is refused at sign-in and on every sale write, even with a live session", async ({ page }) => {
  await signIn(page, USERS.agent);
  const own = await ownOrgAndStove(USERS.agent);

  await branchSql(`update public.profiles set status = 'disabled' where email = '${USERS.agent}'`);
  try {
    const sale = await callEdgeFunction(page, "create-sale", saleBody(own, `${TAG}-${Date.now()}`, `0803${String(Date.now()).slice(-7)}`));
    expect.soft(sale.status, JSON.stringify(sale.body)).toBe(403);
    expect.soft((sale.body as Reply).message ?? "", "a message the phone can show").toMatch(/disabled/i);
    expect.soft((sale.body as Reply).message ?? "", "never read by the phone as already saved").not.toMatch(/transaction id/i);

    const edit = await callEdgeFunction(page, "update-sale", { amount: 1 }, "?id=00000000-0000-4000-8000-000000000000");
    expect.soft(edit.status, JSON.stringify(edit.body)).toBe(403);

    const del = await callEdgeFunction(page, "delete-sale", { saleId: "00000000-0000-4000-8000-000000000000" });
    expect.soft(del.status, JSON.stringify(del.body)).not.toBe(200);
    expect.soft(JSON.stringify(del.body)).toMatch(/not active/i);

    const login = await signInDirect(page, USERS.agent);
    expect.soft(login.status, String(login.body?.error ?? "signed in")).toBe(403);
    expect.soft(String(login.body?.error ?? "")).toMatch(/disabled/i);
  } finally {
    await branchSql(`update public.profiles set status = 'active' where email = '${USERS.agent}'`);
  }
});

test("disabling through the User Manager bans the login, and enabling lifts it", async ({ page }) => {
  await signIn(page, USERS.admin);
  const [agent] = await branchSql<{ id: string }>(`select id::text as id from public.profiles where email = '${USERS.agent}'`);
  expect(agent?.id, "the seeded partner agent").toBeTruthy();

  const banned = async () => {
    const [row] = await branchSql<{ banned: boolean }>(
      `select coalesce(banned_until > now(), false) as banned from auth.users where id = '${agent.id}'`,
    );
    return row?.banned;
  };

  const patch = (status: string) =>
    page.evaluate(async ({ id, status }) => {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
      const token = stored.access_token ?? stored?.currentSession?.access_token;
      const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
      const res = await fetch(`https://${ref}.supabase.co/functions/v1/manage-users/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { id: agent.id, status });

  try {
    const off = await patch("disabled");
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await banned(), "the login is banned").toBe(true);

    const on = await patch("active");
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(await banned(), "and the ban is lifted").toBe(false);
  } finally {
    await branchSql(`update public.profiles set status = 'active' where id = '${agent.id}'`);
    await branchSql(`update auth.users set banned_until = null where id = '${agent.id}'`);
  }
});

test("the shared-phone flag from someone who may not commit imports is ignored", async ({ page }) => {
  await signIn(page, USERS.partner);
  const seed = Date.now();
  const phone = `0804${String(seed).slice(-7)}`;

  const first = await callEdgeFunction(page, "create-sale", saleBody(await ownOrgAndStove(USERS.partner), `${TAG}-${seed}`, phone));
  expect([200, 201], `first sale: ${first.status} ${JSON.stringify(first.body)}`).toContain(first.status);

  // The same buyer again, asking to share the number: refused as a repeat buyer.
  const second = await callEdgeFunction(
    page,
    "create-sale",
    saleBody(await ownOrgAndStove(USERS.partner), `${TAG}-${seed + 1}`, phone, { allowSharedPhone: true }),
  );
  expect(second.status, JSON.stringify(second.body)).toBe(409);
  expect(JSON.stringify(second.body)).toMatch(/same name and phone number/i);
});

test("the shared-phone flag from someone who may commit imports is still honoured", async ({ page }) => {
  await signIn(page, USERS.dataManager);
  const seed = Date.now();
  const phone = `0805${String(seed).slice(-7)}`;

  const first = await callEdgeFunction(page, "create-sale", saleBody(await ownOrgAndStove(USERS.partner), `${TAG}-${seed}`, phone));
  expect([200, 201], `first sale: ${first.status} ${JSON.stringify(first.body)}`).toContain(first.status);

  // The same buyer again from the import's own caller: saved, as digitalisation.
  const second = await callEdgeFunction(
    page,
    "create-sale",
    saleBody(await ownOrgAndStove(USERS.partner), `${TAG}-${seed + 1}`, phone, { allowSharedPhone: true }),
  );
  expect([200, 201], `second sale: ${second.status} ${JSON.stringify(second.body)}`).toContain(second.status);
});

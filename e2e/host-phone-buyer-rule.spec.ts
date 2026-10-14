import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The phone number and buyer rule, on the server (Phase 1 of
 * docs/plans/phone-and-buyer-rule.md).
 *
 * A household shares a phone, so a number already on a sale may go on another
 * when the buyer's name differs, and the sale that saves is told which sales it
 * shares the number with. The same name on the same number is the same customer
 * entered twice and is refused, across every partner. The Data Center's
 * digitisation is never refused and marks the repeat instead.
 *
 * What this proves, each case against today's code first:
 *
 *  1. A different name on a number another partner holds saves. The reply
 *     names only sales the caller may already see: nothing to the partner, the
 *     sharing sales (`same_buyer: false`) to a super admin.
 *     (Red: refused as "already used on sale".)
 *  2. The same name and number at another partner is refused with
 *     `SAME_BUYER_SAME_PHONE` and a message that never says "transaction id",
 *     leaving no sale and no sold stove behind. The other sale is named only
 *     to someone who may see it. (Red: the old check runs as the caller,
 *     cannot see the other partner's sale, and lets it through.)
 *  3. The same buyer written differently (surname first, capitals, "+234",
 *     a title, an alias in brackets) is still the same buyer.
 *  4. Disconfirming: the same name on a different number saves. A name alone
 *     never refuses.
 *  5. A retried sale whose first attempt saved gets the answer the phone app
 *     reads as "already saved". (Red: refused as a duplicate phone first.)
 *  6. A cancelled sale's number and name are free again. (Red: still refused.)
 *  7. Digitisation (`allowSharedPhone: true`) saves the same buyer and marks
 *     the earlier sale `same_buyer: true`.
 *  8. update-sale: re-saving unchanged details saves; renaming a sale into the
 *     same buyer as another on its number is refused, even when only the name
 *     changed. (Red: a name-only edit was never checked.)
 *  9. Phone app 1.0.18's own body (joined name only, no opt-in) is refused for
 *     the same buyer with a message it shows as is, and a batch with one
 *     refused sale still saves the others.
 */

const TAG = "E2EPBR";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const PARTNER_ORG = "a0000000-0000-4000-8000-000000000001"; // partner@ and agent@
const spent = new Set<string>();
const run = String(Date.now() % 1e6).padStart(6, "0");

/** A number nobody else on the branch holds: 0803 + run + slot. */
function phone(slot: number): string {
  return `0803${run}${slot}`;
}

async function freeStove(org: string): Promise<string> {
  const rows = await branchSql<{ stove_id: string }>(
    `select stove_id from public.stove_ids_base
      where organization_id = '${org}' and status = 'available' and sale_id is null
        and is_archived is not true
      order by stove_id limit 50`,
  );
  const free = rows.map((r) => r.stove_id).find((s) => !spent.has(s));
  expect(free, `a free stove at ${org}`).toBeTruthy();
  spent.add(free!);
  return free!;
}

async function partnerName(org: string): Promise<string> {
  const [o] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${org}'`,
  );
  return o.name;
}

let seq = 0;
async function body(
  org: string,
  buyer: { first?: string | null; surname?: string | null; joined?: string | null },
  phoneNumber: string,
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return {
    transactionId: `${TAG}-${run}-${seq}`,
    stoveSerialNo: await freeStove(org),
    organizationId: org,
    partnerName: await partnerName(org),
    salesDate: "2026-10-01",
    amount: 25000,
    ...(buyer.joined !== undefined ? { endUserName: buyer.joined } : {}),
    ...(buyer.first !== undefined ? { endUserFirstName: buyer.first } : {}),
    ...(buyer.surname !== undefined ? { endUserSurname: buyer.surname } : {}),
    phone: phoneNumber,
    contactPerson: "Spec Contact",
    contactPhone: phoneNumber,
    salesAgentName: "Spec Agent",
    termsAccepted: {
      poaGoverned: true,
      monitoring: true,
      noResell: true,
      emissionReductions: true,
      noExport: true,
      demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Road`, state: "Kogi", city: "Lokoja" },
    ...extra,
  };
}

type SaleReply = {
  success?: boolean;
  code?: string;
  message?: string;
  transactionId?: string;
  data?: { id?: string };
  shares_phone_with?: { sale_id: string; transaction_id: string; same_buyer: boolean }[];
};

async function sell(page: Page, payload: Record<string, unknown>) {
  const r = await callEdgeFunction(page, "create-sale", payload);
  return { status: r.status, body: r.body as SaleReply };
}

async function saleCount(transactionId: unknown): Promise<number> {
  const [r] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales where transaction_id = '${transactionId}'`,
  );
  return r.n;
}

async function stoveStatus(serial: unknown): Promise<string> {
  const [r] = await branchSql<{ status: string }>(
    `select status from public.stove_ids_base where stove_id = '${serial}'`,
  );
  return r.status;
}

test.afterAll(async () => {
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.installment_payments where sale_id in (${mine})`).catch(
    () => {},
  );
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test.describe.serial("phone and buyer rule on the server", () => {
  const P = phone(1);
  let first: { id: string; transactionId: string };

  test("the first sale on a number saves as it always did", async ({ page }) => {
    await signIn(page, USERS.admin);
    const b = await body(TWIN_A, { first: "Aisha", surname: "Bello" }, P);
    const r = await sell(page, b);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).not.toHaveProperty("shares_phone_with");
    first = { id: r.body.data!.id!, transactionId: b.transactionId };
  });

  test("a different name on that number at another partner saves, and names nothing it may not see", async ({
    page,
  }) => {
    await signIn(page, USERS.partner);
    const b = await body(PARTNER_ORG, { first: "Musa", surname: "Bello" }, P);
    const r = await sell(page, b);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // The first sale is another partner's: the partner is not told about it.
    expect(r.body).not.toHaveProperty("shares_phone_with");
  });

  test("someone who may see the other sales is told which share the number", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await sell(page, await body(TWIN_A, { first: "Grace", surname: "Okon" }, P));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const shared = r.body.shares_phone_with ?? [];
    expect(shared.find((s) => s.sale_id === first.id)).toEqual({
      sale_id: first.id,
      transaction_id: first.transactionId,
      same_buyer: false,
    });
    expect(shared.length, "the first sale and the partner's Musa Bello").toBe(2);
  });

  test("the same name and number at another partner is refused, unnamed, and nothing is left", async ({
    page,
  }) => {
    await signIn(page, USERS.partner);
    const b = await body(PARTNER_ORG, { first: "Aisha", surname: "Bello" }, P);
    const r = await sell(page, b);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.code).toBe("SAME_BUYER_SAME_PHONE");
    expect(r.body.transactionId ?? null).toBeNull();
    expect(r.body.message).not.toContain(first.transactionId);
    expect(r.body.message).toMatch(/already registered on another sale/i);
    expect(r.body.message).not.toMatch(/transaction id/i);
    expect(await saleCount(b.transactionId)).toBe(0);
    expect(await stoveStatus(b.stoveSerialNo)).toBe("available");
  });

  test("the refusal names the other sale for someone who may see it", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await sell(page, await body(TWIN_A, { first: "Aisha", surname: "Bello" }, P));
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.transactionId).toBe(first.transactionId);
    expect(r.body.message).toContain(first.transactionId);
  });

  test("the same buyer written differently is still the same buyer", async ({ page }) => {
    await signIn(page, USERS.partner);
    const variants = [
      { buyer: { first: "BELLO", surname: "aisha" }, phone: `+234${P.slice(1)}` },
      { buyer: { first: "Mrs Aisha", surname: "Bello [Mama Ade]" }, phone: P },
      { buyer: { joined: "Bello, Aisha" }, phone: `234 ${P.slice(1)}` },
    ];
    for (const v of variants) {
      const r = await sell(page, await body(PARTNER_ORG, v.buyer, v.phone));
      expect(r.status, `${JSON.stringify(v)} -> ${JSON.stringify(r.body)}`).toBe(409);
      expect(r.body.code).toBe("SAME_BUYER_SAME_PHONE");
    }
  });

  test("the same name on a different number saves: a name alone never refuses", async ({
    page,
  }) => {
    await signIn(page, USERS.partner);
    const r = await sell(
      page,
      await body(PARTNER_ORG, { first: "Aisha", surname: "Bello" }, phone(2)),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  test("a retried sale that already saved is answered as already saved", async ({ page }) => {
    await signIn(page, USERS.partner);
    const b = await body(PARTNER_ORG, { first: "Retry", surname: "Buyer" }, phone(3));
    const once = await sell(page, b);
    expect(once.status, JSON.stringify(once.body)).toBe(200);
    // The phone app sends the identical body again when the reply was lost.
    const again = await sell(page, b);
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    const msg = String(again.body.message).toLowerCase();
    // Exactly what sync_service.dart's _alreadyCreated looks for.
    expect(msg).toContain("transaction id");
    expect(msg).toContain("already exists");
    expect(await saleCount(b.transactionId)).toBe(1);
  });

  test("a cancelled sale's number and name are free again", async ({ page }) => {
    await signIn(page, USERS.partner);
    const b = await body(PARTNER_ORG, { first: "Cancelled", surname: "Buyer" }, phone(4));
    expect((await sell(page, b)).status).toBe(200);
    await branchSql(
      `update public.sales set is_archived = true where transaction_id = '${b.transactionId}'`,
    );
    const r = await sell(
      page,
      await body(PARTNER_ORG, { first: "Cancelled", surname: "Buyer" }, phone(4)),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  test("digitisation saves the same buyer and marks the repeat", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await sell(
      page,
      await body(TWIN_A, { first: "Aisha", surname: "Bello" }, P, { allowSharedPhone: true }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const marks = Object.fromEntries(
      (r.body.shares_phone_with ?? []).map((s) => [s.sale_id, s.same_buyer]),
    );
    expect(marks[first.id]).toBe(true);
  });

  test("update-sale: unchanged details save; renaming into the same buyer is refused", async ({
    page,
  }) => {
    await signIn(page, USERS.partner);
    const [musa] = await branchSql<{ id: string; phone: string }>(
      `select id::text, phone from public.sales
        where transaction_id like '${TAG}-${run}-%' and end_user_first_name = 'Musa'`,
    );
    const edit = (first: string, surname: string) =>
      callEdgeFunction(
        page,
        "update-sale",
        {
          endUserName: `${first} ${surname}`,
          endUserFirstName: first,
          endUserSurname: surname,
          phone: musa.phone,
          contactPerson: "Spec Contact",
          contactPhone: musa.phone,
        },
        `?id=${musa.id}`,
      );
    const same = await edit("Musa", "Bello");
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    // Only the name changes, onto the first sale's buyer.
    const renamed = await edit("Aisha", "Bello");
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(409);
    expect((renamed.body as SaleReply).code).toBe("SAME_BUYER_SAME_PHONE");
    const [after] = await branchSql<{ first: string }>(
      `select end_user_first_name as first from public.sales where id = '${musa.id}'`,
    );
    expect(after.first, "the refused edit wrote nothing").toBe("Musa");
  });

  test("phone app 1.0.18: its own body is refused for the same buyer, and a batch carries on", async ({
    page,
  }) => {
    await signIn(page, USERS.agent);
    // The app sends the joined name and no opt-in; its sync loop posts each
    // queued sale on its own, so a batch is three posts in a row.
    const batch = [
      await body(PARTNER_ORG, { joined: "Batch One" }, phone(5)),
      await body(PARTNER_ORG, { joined: "Aisha Bello" }, P),
      await body(PARTNER_ORG, { joined: "Batch Three" }, phone(6)),
    ];
    const results = [];
    for (const b of batch) results.push(await sell(page, b));
    expect(results.map((r) => r.status)).toEqual([200, 409, 200]);
    const refused = results[1].body;
    expect(refused.message).toMatch(/same customer cannot be recorded twice/i);
    // The first sale is another partner's, so it is not named to this agent.
    expect(refused.message).not.toContain(first.transactionId);
    // Not what the app reads as "already saved", so it is shown, not cleared.
    const m = String(refused.message).toLowerCase();
    expect(m.includes("transaction id") && m.includes("already exists")).toBe(false);
  });
});

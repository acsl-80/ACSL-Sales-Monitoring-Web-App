import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The phone number and buyer rule on the screens (Phase 2 of
 * docs/plans/phone-and-buyer-rule.md).
 *
 * Phase 1 put the rule on the server. This proves what people see:
 *
 *  1. The form's lookup, visible_sales_on_phone, runs as the signed-in user
 *     (security invoker): anon cannot call it, a signed-in user can, and it
 *     returns only sales that user may read.
 *  2. Sell Stove, as someone who can see the sales on a number: a different
 *     name shows an amber note and no error; the same name, written another
 *     way, shows the same-customer error naming the sale. One lookup per
 *     typing pause, never a list download. (Red: today's form calls a
 *     duplicate phone an error whatever the name, and never notes.)
 *  3. Sell Stove, as a partner who cannot see those sales: the lookup returns
 *     nothing and the form shows nothing, so the live check reveals no other
 *     partner's customer. The server still refuses the same customer on save
 *     (Phase 1, host-phone-buyer-rule).
 *  4. The Stove record: a number shared by different names is amber; one that
 *     also carries the same customer twice (digitisation) is red, with the
 *     repeat tagged. (Red: every second sale on a number is a red violation.)
 *  5. Typing fast, a character at a time, ends in the right answer: a late
 *     reply to an earlier keystroke never overwrites the latest one.
 *  6. Editing: opening a record that already shares its number shows nothing
 *     (update-sale does not check an unchanged record); renaming it into the
 *     same customer as another sale on the number shows the error.
 *  7. A partner saves a sale through the real Sell Stove screen on a number
 *     another of their sales holds: it saves, with its address and the stove
 *     sold, and the confirmation names the other sale. On the way, a save
 *     refused by the form for a required field with no message of its own
 *     (previous stove type) says so in a banner brought into view. (Red:
 *     today the button appears to do nothing.)
 */

const TAG = "E2EPBS";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const run = String(Date.now() % 1e6).padStart(6, "0");
const P = `0806${run}7`; // a number nobody else on the branch holds
const P2 = `0807${run}3`; // the partner's own shared number, saved through the screen
const PARTNER_ORG = "a0000000-0000-4000-8000-000000000001"; // partner@ and agent@
const spent = new Set<string>();

async function freeStove(org: string): Promise<string> {
  const rows = await branchSql<{ stove_id: string }>(
    `select stove_id from public.stove_ids_base
      where organization_id = '${org}' and status = 'available' and sale_id is null
        and is_archived is not true
      order by stove_id desc limit 50`,
  );
  const free = rows.map((r) => r.stove_id).find((s) => !spent.has(s));
  expect(free, `a free stove at ${org}`).toBeTruthy();
  spent.add(free!);
  return free!;
}

let seq = 0;
async function sell(
  page: Page,
  first: string,
  surname: string,
  extra: Record<string, unknown> = {},
  orgId = TWIN_A,
  phone = P,
): Promise<{ transactionId: string; stove: string }> {
  seq += 1;
  const [org] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${orgId}'`,
  );
  const transactionId = `${TAG}-${run}-${seq}`;
  const stove = await freeStove(orgId);
  const r = await callEdgeFunction(page, "create-sale", {
    transactionId,
    stoveSerialNo: stove,
    organizationId: orgId,
    partnerName: org.name,
    salesDate: "2026-10-01",
    amount: 25000,
    endUserFirstName: first,
    endUserSurname: surname,
    endUserName: `${first} ${surname}`,
    phone,
    contactPerson: "Spec Contact",
    contactPhone: phone,
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
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { transactionId, stove };
}

/** Types into the Sell Stove buyer fields and waits for the lookup that follows. */
async function typeBuyer(page: Page, first: string, surname: string, phone: string) {
  await page.locator("#endUserName").fill(first);
  await page.locator("#endUserSurname").fill(surname);
  const lookup = page.waitForResponse((r) => r.url().includes("/rpc/visible_sales_on_phone"));
  await page.locator("#phone").fill(phone);
  const response = await lookup;
  await expect(page.getByText("Checking…")).toHaveCount(0);
  return (await response.json()) as { transaction_id: string }[];
}

let A: { transactionId: string; stove: string }; // Aisha Bello
let B: { transactionId: string; stove: string }; // Musa Bello, same number
let C: { transactionId: string; stove: string }; // "BELLO, aisha", digitised repeat of A

test.afterAll(async () => {
  // The sale saved through the screen carries the form's own transaction id,
  // so it is found by its number.
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'
                 or right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = '${P2.slice(1)}'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.installment_payments where sale_id in (${mine})`).catch(
    () => {},
  );
  await branchSql(`delete from public.sales where id in (${mine})`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test.describe.serial("phone and buyer rule on the screens", () => {
  test("the form's lookup runs as the caller, and anon cannot call it", async () => {
    const [p] = await branchSql<{ invoker: boolean; anon: boolean; authenticated: boolean }>(`
      select not p.prosecdef as invoker,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p where p.proname = 'visible_sales_on_phone'`);
    expect(p).toEqual({ invoker: true, anon: false, authenticated: true });
  });

  test("set up: two customers on one number, and a digitised repeat of the first", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    A = await sell(page, "Aisha", "Bello");
    B = await sell(page, "Musa", "Bello");
    // Digitisation is the one door that may record the same customer again.
    C = await sell(page, "BELLO,", "aisha", { allowSharedPhone: true });
  });

  test("Sell Stove notes a shared number and refuses the same customer, one lookup per pause", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/sales/create");
    await expect(page.locator("#phone")).toBeVisible();

    const lookups: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/rpc/visible_sales_on_phone")) lookups.push(r.url());
      // The old check read the sales table with an ilike on phone.
      if (r.url().includes("/rest/v1/sales?") && r.url().includes("ilike")) lookups.push("OLD");
    });

    // A different name: a note, not an error.
    const rows = await typeBuyer(page, "Grace", "Okon", P);
    expect(rows.map((r) => r.transaction_id).sort()).toEqual(
      [A.transactionId, B.transactionId, C.transactionId].sort(),
    );
    const note = page.getByTestId("phone-shared-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText(A.transactionId);
    await expect(note).toContainText("will still save");
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "false");

    // The same customer, written another way (a title, the other case).
    await typeBuyer(page, "Mrs AISHA", "bello", "+234" + P.slice(1));
    await expect(page.getByTestId("phone-shared-note")).toHaveCount(0);
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/same name and phone number\) is already registered on sale/)).toContainText(
      A.transactionId,
    );

    // A lookup per pause, not per keystroke, and never the old table read.
    expect(lookups).not.toContain("OLD");
    expect(lookups.length).toBeLessThanOrEqual(4);
  });

  test("a partner who cannot see those sales is shown nothing about them", async ({ page }) => {
    await signIn(page, USERS.partner);
    await page.goto("/sales/create");
    await expect(page.locator("#phone")).toBeVisible();

    const rows = await typeBuyer(page, "Aisha", "Bello", P);
    expect(rows).toEqual([]);
    await expect(page.getByTestId("phone-shared-note")).toHaveCount(0);
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "false");
  });

  test("the Stove record: amber for a shared number, red with the repeat tagged", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);

    // Musa's record: two other names on his number, Aisha twice. Neither is
    // Musa, so it is only a shared number.
    await page.goto(`/data-center/stove/${encodeURIComponent(B.stove)}`);
    const shared = page.getByTestId("phone-twins");
    await expect(shared).toBeVisible({ timeout: 30_000 });
    await expect(shared).toHaveAttribute("data-tone", "shared");
    await expect(shared).toContainText("Shared number: also on 2 other sales");
    await expect(shared.getByText("same customer", { exact: true })).toHaveCount(0);

    // Aisha's record: her digitised repeat is on the number, so red, and only
    // that row is tagged.
    await page.goto(`/data-center/stove/${encodeURIComponent(A.stove)}`);
    const repeat = page.getByTestId("phone-twins");
    await expect(repeat).toBeVisible({ timeout: 30_000 });
    await expect(repeat).toHaveAttribute("data-tone", "same-buyer");
    await expect(repeat).toContainText("The same customer is on 1 other sale");
    const tagged = repeat.locator("li", { hasText: "same customer" });
    await expect(tagged).toHaveCount(1);
    await expect(tagged).toContainText(C.stove);
  });

  test("typing fast ends in the answer for what is in the box, not a late reply", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/sales/create");
    await expect(page.locator("#phone")).toBeVisible();

    await page.locator("#endUserName").fill("Aisha");
    await page.locator("#endUserSurname").fill("Bello");
    // A character at a time, quicker than the pause, then a name change
    // straight after: every reply but the last must be dropped.
    await page.locator("#phone").pressSequentially(P, { delay: 40 });
    await page.locator("#endUserName").fill("Grace");
    await expect(page.getByTestId("phone-shared-note")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "false");

    await page.locator("#endUserName").pressSequentially("x", { delay: 40 });
    await page.locator("#endUserName").fill("Aisha");
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "true", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("phone-shared-note")).toHaveCount(0);
  });

  test("editing: an unchanged shared record shows nothing; a rename into a repeat shows the error", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/sales");
    await page.getByPlaceholder(/Search customer, transaction ID, phone/).fill(B.transactionId);
    const row = page.locator("tr", { hasText: B.transactionId });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    const editButton = row.getByRole("button", { name: "Edit sale" });
    await expect(editButton).toBeVisible();

    const lookups: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/rpc/visible_sales_on_phone")) lookups.push(r.url());
    });
    await editButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#endUserName")).toHaveValue("Musa", { timeout: 30_000 });
    // Musa's number is shared with Aisha twice; opening his record says
    // nothing and asks nothing, as update-sale does not check it.
    await page.waitForTimeout(1_000);
    expect(lookups, "an unchanged record is not looked up").toHaveLength(0);
    await expect(dialog.getByTestId("phone-shared-note")).toHaveCount(0);
    await expect(dialog.locator("#phone")).toHaveAttribute("aria-invalid", "false");

    // Renamed to Aisha Bello, he becomes a repeat of her sales.
    const lookup = page.waitForResponse((r) => r.url().includes("/rpc/visible_sales_on_phone"));
    await dialog.locator("#endUserName").fill("Aisha");
    await lookup;
    await expect(dialog.locator("#phone")).toHaveAttribute("aria-invalid", "true");
    await expect(
      dialog.getByText(/same name and phone number\) is already registered on sale/),
    ).toContainText(A.transactionId);
    // Nothing is saved: the test ends with the dialog unsubmitted.
  });

  test("a partner saves through the Sell Stove screen on a shared number, and is told", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, USERS.partner);
    // The partner's own earlier customer on the number.
    const earlier = await sell(page, "Fatima", "Yusuf", {}, PARTNER_ORG, P2);
    const stove = await freeStove(PARTNER_ORG);

    await page.goto("/sales/create");
    await expect(page.locator("#phone")).toBeVisible();

    const paymentType = page.locator("#paymentType");
    if (await paymentType.isVisible()) {
      await paymentType.click();
      await page.getByRole("option", { name: "Cash purchase" }).click();
    }
    await page.locator("#stoveSerialNo").fill(stove);
    await page.getByText(stove, { exact: true }).click();
    await page.locator("#amount").fill("25000");

    const rows = await typeBuyer(page, "Halima", "Sani", P2);
    expect(rows.map((r) => r.transaction_id)).toEqual([earlier.transactionId]);
    await expect(page.getByTestId("phone-shared-note")).toContainText(earlier.transactionId);

    await page.locator('label[for="sameAsEndUser"]').click();
    await expect(page.locator("#contactPerson")).toHaveValue("Halima Sani");

    await page.getByRole("combobox").filter({ hasText: /^Select state$/ }).click();
    await page.getByRole("option", { name: "Kogi", exact: true }).click();
    await page.getByRole("combobox").filter({ hasText: "Select LGA" }).click();
    await page.getByRole("option").first().click();

    await page.locator("#city").fill("Lokoja");
    const address = page.getByPlaceholder(/Search address in/);
    await address.fill(`${TAG} Screen Road, Lokoja`);
    await address.press("Tab");
    await expect(page.getByText(`${TAG} Screen Road, Lokoja`).first()).toBeVisible();

    await page.getByRole("button", { name: "Accept all" }).click();

    const signToggle = page.getByRole("button", { name: "Tap to sign" });
    await signToggle.scrollIntoViewIfNeeded();
    await signToggle.click();
    const canvas = page.locator("canvas").first();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("the signature canvas is not on screen");
    await page.mouse.move(box.x + 20, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 60, { steps: 10 });
    await page.mouse.move(box.x + 60, box.y + 90, { steps: 10 });
    await page.mouse.up();

    // Left blank on purpose: previous stove type is required by the field
    // rules but has no message of its own. A refused save must say so on
    // screen, not leave the button looking dead (found building this spec).
    await page.getByRole("button", { name: "Create Sale" }).click();
    const banner = page.getByRole("alert").filter({ hasText: "Not saved yet" });
    await expect(banner).toBeVisible();
    await expect(banner).toBeInViewport();
    await expect(banner).toContainText(/stove/i);
    await page.locator('input[name="previousStoveType"]').first().check();

    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("supabase.co")) sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    const saved = page.waitForResponse((r) => r.url().includes("/functions/v1/create-sale"), {
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Create Sale" }).click();
    // If the form's own check stops the save, say what it said and sent.
    const reply = await saved.catch(async () => {
      const said = await page.locator(".text-red-500, .text-red-600, .text-red-700").allInnerTexts();
      throw new Error(
        `the form did not send the sale; it said: ${said.join(" | ")}; it sent: ${sent.join(", ")}`,
      );
    });
    expect(reply.status(), await reply.text()).toBe(200);

    // The confirmation names the other sale, and the page moves on.
    await expect(page.getByText(`also on sale ${earlier.transactionId}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/sales$/);

    // Saved whole: the sale, its address (the 14 Oct defect) and the stove sold.
    const [sale] = await branchSql<{ address: string | null; status: string; org: string }>(
      `select a.full_address as address, sb.status, s.organization_id::text as org
         from public.sales s
         left join public.addresses a on a.id = s.address_id
         left join public.stove_ids_base sb on sb.sale_id = s.id
        where right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = '${P2.slice(1)}'
          and s.end_user_first_name = 'Halima'`,
    );
    expect(sale, "the sale saved").toBeTruthy();
    expect(sale.address).toContain(`${TAG} Screen Road`);
    expect(sale.status).toBe("sold");
    expect(sale.org).toBe(PARTNER_ORG);
  });
});

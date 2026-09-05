import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction, commitAndDrain } from "./helpers";

/**
 * The sale record carries the agreement's own fields (D29, slice F2).
 *
 * The customer's name lives in two forms that never disagree: a writer that
 * knows the two parts gets the joined name composed for it and marked entered,
 * a writer that knows only the joined name gets the parts split by rule and
 * marked rule, and a later edit to either form re-derives the other. A receipt
 * carries the agreement's own fields through the import to the sale: the two
 * name parts, the agent who sold the stove, the town as written rather than the
 * LGA. The two write endpoints the clients use take the new keys: update-sale
 * accepts a surname, a branch and an agent name, and create-sale accepts the
 * name in parts instead of joined.
 *
 * Red on main: none of end_user_first_name, end_user_surname,
 * name_split_source or selling_agent_name exists on public.sales, so every
 * read-back here fails at the column; the import writes the LGA into the
 * address's city and knows no agent column; update-sale ignores a surname, a
 * branch and an agent name; and create-sale refuses a body that names the two
 * parts instead of endUserName.
 */

test.describe.configure({ timeout: 240_000 });

const TAG = "E2EF2";
const IMPORT_MARKER = `${TAG}-IMPORT`;
const DIRECT_MARKER = `${TAG}-DIRECT`;

/** The seeded org and agent the host specs write direct sales against. */
const ORG = "a0000000-0000-4000-8000-000000000001";
const AGENT = "b0000000-0000-4000-8000-000000000005";

/** The partner seeded with free stoves on every preview branch. */
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";

type NameRow = {
  first: string | null;
  surname: string | null;
  joined: string | null;
  source: string | null;
};

async function nameOf(transactionId: string): Promise<NameRow> {
  const [row] = await branchSql<NameRow>(
    `select end_user_first_name as first, end_user_surname as surname,
            end_user_name as joined, name_split_source as source
       from public.sales where transaction_id = '${transactionId}'`,
  );
  return row;
}

/** An address of this spec's own, so cleanup can find it by its marker. */
async function freshAddressId(): Promise<string> {
  const [made] = await branchSql<{ id: string }>(
    `insert into public.addresses (full_address, state)
     values ('${TAG} 1 Test Road', 'Kogi') returning id::text`,
  );
  return made.id;
}

type Name = { endUserName?: string; firstName?: string; surname?: string };

/**
 * One sale, written through the table so the trigger decides the name, with
 * every column the sales app requires. Only the name columns the case is about
 * are named, so the trigger sees exactly the writer it is being tested for.
 */
async function writeSale(n: number, addressId: string, name: Name): Promise<void> {
  const cols: string[] = [];
  const vals: string[] = [];
  const put = (col: string, value: string | undefined) => {
    if (value === undefined) return;
    cols.push(col);
    vals.push(`'${value}'`);
  };
  put("end_user_name", name.endUserName);
  put("end_user_first_name", name.firstName);
  put("end_user_surname", name.surname);
  await branchSql(
    `insert into public.sales (
       transaction_id, stove_serial_no, sales_date, phone,
       contact_person, contact_phone, partner_name, retailer_branch, state_backup,
       lga_backup, amount, total_paid, is_installment, payment_status,
       organization_id, created_by, platform, address_id${cols.length ? `, ${cols.join(", ")}` : ""})
     values ('${TAG}-${n}', '${TAG}-S${n}', current_date, '0801000030${n}',
             'E2E Name Contact', '0801000040${n}', 'E2E Partner', 'Main', 'Kogi',
             'Lokoja', 43000, 43000, false, 'fully_paid',
             '${ORG}', '${AGENT}', 'web', '${addressId}'${vals.length ? `, ${vals.join(", ")}` : ""})`,
  );
}

/** Serials this run has already spent, so two tests never race for one stove. */
const spentSerials = new Set<string>();

async function freeStove(page: Page): Promise<string> {
  const stoves = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: TWIN_A,
    limit: 100,
  });
  expect(stoves.status, JSON.stringify(stoves.body)).toBe(200);
  const free = (
    (stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data
      ?.stoves ?? []
  ).find((s) => !s.sale_id && !spentSerials.has(s.stove_id))?.stove_id;
  expect(free, "a free stove of the twin partner to sell").toBeTruthy();
  spentSerials.add(free!);
  return free!;
}

async function partnerName(): Promise<string> {
  const [org] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${TWIN_A}'`,
  );
  expect(org?.name, "the twin partner is seeded").toBeTruthy();
  return org.name;
}

/**
 * The receipt from test 2, arranged once and found again afterwards.
 *
 * A retried test runs in a fresh worker, after the first worker's afterAll has
 * already cleared the fixture, so the module variable is not enough on its own:
 * the address marker is the durable handle, and an arrangement happens only
 * when neither turns one up.
 */
let importedSaleId: string | null = null;

async function findImported(): Promise<string | null> {
  const [row] = await branchSql<{ id: string }>(
    `select s.id::text as id from public.sales s
       join public.addresses a on a.id = s.address_id
      where a.full_address like '${IMPORT_MARKER} %'
      order by s.created_at desc limit 1`,
  );
  return row?.id ?? null;
}

async function importedSale(page: Page): Promise<string> {
  if (importedSaleId) return importedSaleId;
  const found = await findImported();
  if (found) {
    importedSaleId = found;
    return found;
  }

  const serial = await freeStove(page);
  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename: `${IMPORT_MARKER}.csv`,
    rows: [
      {
        sales_model: "Amina Model",
        stove_serial_no: serial,
        first_name: "Paper",
        last_name: "Receipt Two",
        phone: "08012345688",
        sales_date: "2026-01-05",
        amount: "25000",
        state: "Kogi",
        lga: "Isanlu",
        address: `${IMPORT_MARKER} Paper Road`,
        city: "Isanlu Town",
        sales_agent_name: "Musa Danladi",
      },
    ],
    confirmDuplicate: true,
  });
  expect(staged.status, JSON.stringify(staged.body)).toBe(200);
  const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

  const validated = await callEdgeFunction(page, "data-center-import", {
    action: "validate",
    batchId,
  });
  expect(validated.status, JSON.stringify(validated.body)).toBe(200);
  const drained = await commitAndDrain(page, batchId);
  expect(drained.state, JSON.stringify(drained)).toBe("committed");

  const [row] = await branchSql<{ id: string }>(
    `select r.sale_id::text as id from data_center.import_rows r
      where r.batch_id = '${batchId}' and r.sale_id is not null limit 1`,
  );
  expect(row?.id, "the receipt became a sale").toBeTruthy();
  importedSaleId = row.id;
  return row.id;
}

test.afterAll(async () => {
  /*
   * Stock first, because the check constraint permits 'sold' only while
   * sale_id is set; then the sales, by their tag and by this spec's address
   * marker (the import names its own transaction ID, so the marker is the only
   * handle on that one); then the batches, whose rows and stove claims cascade
   * with them; then the addresses.
   */
  const mine = `select s.id from public.sales s
       left join public.addresses a on a.id = s.address_id
      where s.transaction_id like '${TAG}-%' or a.full_address like '${TAG}%'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null
      where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(
    `delete from public.sales s
      where s.transaction_id like '${TAG}-%'
         or s.address_id in (select id from public.addresses where full_address like '${TAG}%')`,
  ).catch(() => {});
  await branchSql(`delete from data_center.import_batches where filename like '${TAG}%'`).catch(
    () => {},
  );
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test("the row keeps the name in two forms, whichever form was written", async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`);
  const addressId = await freshAddressId();

  await writeSale(1, addressId, { endUserName: "Amina Bello Musa" });
  await writeSale(2, addressId, { firstName: "Chidi", surname: "Okafor" });
  await writeSale(3, addressId, { endUserName: "Ngozi" });

  // A joined name alone: first word, then the rest, and said to be a rule split.
  const joinedOnly = await nameOf(`${TAG}-1`);
  expect(joinedOnly.first, "the first word of the joined name").toBe("Amina");
  expect(joinedOnly.surname, "everything after the first word").toBe("Bello Musa");
  expect(joinedOnly.source, "a name split by the rule says so").toBe("rule");

  // The parts alone: the joined name is composed, and marked as entered.
  const partsOnly = await nameOf(`${TAG}-2`);
  expect(partsOnly.joined, "the joined name composed from the parts").toBe("Chidi Okafor");
  expect(partsOnly.source, "a writer that gave both parts entered them").toBe("entered");

  // One word is a surname with no first name, as the agreement reads it.
  const oneWord = await nameOf(`${TAG}-3`);
  expect(oneWord.surname, "a single word is the surname").toBe("Ngozi");
  expect(oneWord.first, "a single word leaves no first name").toBeNull();

  // A later edit to the joined name alone re-splits it.
  await branchSql(
    `update public.sales set end_user_name = 'Chidi Nnamdi Okafor'
      where transaction_id = '${TAG}-2'`,
  );
  const resplit = await nameOf(`${TAG}-2`);
  expect(resplit.first, "the first word of the edited joined name").toBe("Chidi");
  expect(resplit.surname, "everything after it").toBe("Nnamdi Okafor");
  expect(resplit.source, "an edit to the joined name alone is a rule split").toBe("rule");

  // A later edit to the parts recomposes the joined name.
  await branchSql(
    `update public.sales set end_user_first_name = 'Amina', end_user_surname = 'Musa'
      where transaction_id = '${TAG}-1'`,
  );
  const recomposed = await nameOf(`${TAG}-1`);
  expect(recomposed.joined, "the joined name recomposed from the edited parts").toBe("Amina Musa");
  expect(recomposed.source, "an edit to the parts is an entered name").toBe("entered");
});

test("the import carries the agreement's fields to the sale", async ({ page }) => {
  await signIn(page, USERS.admin);
  const saleId = await importedSale(page);

  const [row] = await branchSql<{
    first: string | null;
    surname: string | null;
    joined: string | null;
    source: string | null;
    agent: string | null;
    lga: string | null;
    city: string | null;
    address: string | null;
  }>(
    `select s.end_user_first_name as first, s.end_user_surname as surname,
            s.end_user_name as joined, s.name_split_source as source,
            s.selling_agent_name as agent, s.lga_backup as lga,
            a.city as city, a.full_address as address
       from public.sales s
       left join public.addresses a on a.id = s.address_id
      where s.id = '${saleId}'`,
  );

  expect(row?.first, "the sheet's First name reached the sale").toBe("Paper");
  expect(row?.surname, "the sheet's Surname reached the sale").toBe("Receipt Two");
  expect(row?.joined, "the joined name composed from the two parts").toBe("Paper Receipt Two");
  expect(row?.source, "the sheet gave both parts, so nothing was guessed").toBe("entered");
  expect(row?.agent, "the sheet's sales agent reached the sale").toBe("Musa Danladi");
  expect(row?.lga, "the LGA is still the LGA").toBe("Isanlu");
  // The town as written, not the LGA standing in for it, which is what the
  // import used to put here.
  expect(row?.city, "the sheet's city reached the address").toBe("Isanlu Town");
  expect(row?.address, "the address text reached the address").toContain(IMPORT_MARKER);
});

test("update-sale takes the surname, the branch and the agent's name", async ({ page }) => {
  await signIn(page, USERS.admin);
  const saleId = await importedSale(page);

  const [before] = await branchSql<{
    phone: string | null;
    contact_person: string | null;
    contact_phone: string | null;
  }>(`select phone, contact_person, contact_phone from public.sales where id = '${saleId}'`);
  expect(before?.phone, "the sale carries the phone update-sale demands").toBeTruthy();
  expect(before?.contact_person, "the sale carries a contact person").toBeTruthy();
  expect(before?.contact_phone, "the sale carries a contact phone").toBeTruthy();

  const updated = await callEdgeFunction(
    page,
    "update-sale",
    {
      // Required by the endpoint, and sent unchanged apart from the name.
      // The joined name is sent to agree with the parts rather than to fight
      // them: a body whose two forms disagree is a body the endpoint refuses.
      endUserName: "Paper Receipt Three",
      phone: before.phone,
      contactPerson: before.contact_person,
      contactPhone: before.contact_phone,
      endUserSurname: "Receipt Three",
      retailerBranch: "Branch Nine",
      salesAgentName: "Aisha Umar",
    },
    `?id=${saleId}`,
  );
  expect(updated.status, JSON.stringify(updated.body)).toBe(200);

  const [row] = await branchSql<{
    surname: string | null;
    joined: string | null;
    branch: string | null;
    agent: string | null;
  }>(
    `select end_user_surname as surname, end_user_name as joined,
            retailer_branch as branch, selling_agent_name as agent
       from public.sales where id = '${saleId}'`,
  );
  expect(row?.surname, "the new surname was written").toBe("Receipt Three");
  expect(row?.joined, "the joined name follows the parts").toBe("Paper Receipt Three");
  expect(row?.branch, "the branch was written").toBe("Branch Nine");
  expect(row?.agent, "the agent's name was written").toBe("Aisha Umar");
});

test("create-sale takes the name in parts, and the agent's name", async ({ page }) => {
  await signIn(page, USERS.admin);
  const serial = await freeStove(page);
  const partner = await partnerName();

  const created = await callEdgeFunction(page, "create-sale", {
    transactionId: `${DIRECT_MARKER}-${Date.now()}`,
    stoveSerialNo: serial,
    organizationId: TWIN_A,
    partnerName: partner,
    salesDate: "2026-01-06",
    amount: 25000,
    // The two parts instead of the joined name: what the agreement carries.
    endUserFirstName: "Direct",
    endUserSurname: "Caller",
    phone: "08012345677",
    contactPerson: "Direct Caller",
    contactPhone: "08012345677",
    salesAgentName: "Bala Sani",
    addressData: {
      fullAddress: `${DIRECT_MARKER} Direct Road`,
      state: "Kogi",
      city: "Lokoja",
    },
  });
  expect(
    [200, 201],
    `create-sale answered ${created.status}: ${JSON.stringify(created.body)}`,
  ).toContain(created.status);
  const saleId = (created.body as { data?: { id?: string } }).data?.id;
  expect(saleId, "create-sale named the sale it made").toBeTruthy();

  const [row] = await branchSql<{
    joined: string | null;
    first: string | null;
    surname: string | null;
    source: string | null;
    agent: string | null;
    city: string | null;
  }>(
    `select s.end_user_name as joined, s.end_user_first_name as first,
            s.end_user_surname as surname, s.name_split_source as source,
            s.selling_agent_name as agent, a.city as city
       from public.sales s
       left join public.addresses a on a.id = s.address_id
      where s.id = '${saleId}'`,
  );
  expect(row?.joined, "the joined name composed from the parts").toBe("Direct Caller");
  expect(row?.first, "the first name as sent").toBe("Direct");
  expect(row?.surname, "the surname as sent").toBe("Caller");
  expect(row?.source, "the caller gave both parts, so nothing was guessed").toBe("entered");
  expect(row?.agent, "the agent's name was written").toBe("Bala Sani");
  expect(row?.city, "the city as sent, on the address the sale points at").toBe("Lokoja");
});

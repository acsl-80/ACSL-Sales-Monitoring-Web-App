// Data Center: bulk import of digitalized paper receipts.
import { normalizeNigerianPhone } from "../_shared/nigerian-phone.ts";
import { excelSerialToIso } from "../_shared/data-center-dates.ts";
//
// THE SHAPE, AND WHY IT IS THIS SHAPE
//
// Committing a receipt backlog moves hundreds of stoves from `available` to
// `sold` and visibly changes the sales app's own inventory figures. That is the
// correct outcome, and it is not something anyone should meet by surprise. So
// the path is four separate, explicit steps rather than an upload button:
//
//   stage      rows land in data_center, raw payload kept
//   validate   each row checked and matched against stock, with a reason
//   dry run    what a commit WOULD change, written down, nothing touched
//   commit     sales created through create-sale, in slices, reversible
//
// A RULE THIS FUNCTION DOES NOT BREAK
//
// It never inserts into public.sales. Every sale is created by calling
// create-sale, the same function the Sell Stove form uses, so stock linking,
// status evaluation, phone validation and org scoping stay in one place. A
// second way to create a sale would be a second version of the truth.
//
// WHY WORK IS SLICED
//
// A batch is thousands of rows and each one is an HTTP call to create-sale. No
// single request does the whole thing: each invocation takes a bounded slice,
// records where it stopped, and returns. The client asks again until the batch
// is done, and a failure resumes rather than restarting.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  withConnection,
  withReadConnection,
  type PoolClient,
} from "../_shared/data-center-db.ts";
import { featuresFor } from "../_shared/data-center-roles.ts";
import {
  CALL_SOURCE,
  callSheetSpec,
  commitCallRows,
  rollbackCallRows,
  validateCallRows,
} from "./call-import.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  if (!origin) return true;
  const configured = (Deno.env.get("DATA_CENTER_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  return (
    [...DEFAULT_ORIGINS, ...configured].includes(origin) ||
    ORIGIN_SUFFIXES.some((s) => origin.endsWith(s))
  );
}

function resolveCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (originAllowed(origin) && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

class BadRequest extends Error {}

// ---------------------------------------------------------------------------
// Row validation
//
// Every rule here mirrors one create-sale enforces. Checking first is not
// duplication for its own sake: it turns "the 412th row failed" into a list an
// operator can work through before anything is written.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date typed into Excel, as Excel actually stores it.
 *
 * The sheet this module hands out writes every cell as text, so a freshly
 * downloaded file reads back as text and a round-trip test passes. The moment
 * a digitiser types a date into the Sales Date column, Excel stores a serial
 * number instead - 2026-07-31 becomes 46234 - and the file comes back with a
 * number where the date was.
 *
 * The refusal even anticipated this: it told the operator to "format that
 * column as Date and save again". That is our problem handed to them. The
 * conversion is four lines and exact.
 *
 * The epoch is 1899-12-30 rather than 1900-01-01 because Excel believes 1900
 * was a leap year. Serials above 59 are all shifted by that phantom day, and
 * every date this system will ever see is far above 59.
 *
 * Bounded to 2015-2100 on purpose. An unbounded reading would turn any stray
 * number typed into the wrong column into a confident, wrong date; outside the
 * window the row is still refused, and the operator still gets told why.
 */
// The parser itself lives in _shared/data-center-dates.ts, imported above:
// the call-centre import reads dates out of the same spreadsheets, and two
// copies is two answers to "what year is 46217" the first time one is fixed.

/**
 * A transaction ID, in create-sale's own format.
 *
 * The Sell Stove form generates this in the browser: six characters from A-Z
 * and 0-9. create-sale requires one and refuses a duplicate, so the import has
 * to mint them too rather than leave the field out.
 *
 * 36^6 is about 2.2 billion, so a single collision is unlikely but not rare
 * across a real backlog: at 500,000 existing sales each new id has roughly a
 * 0.023% chance of clashing, which is a hundred or so clashes over a full
 * import. Hence the retry at the call site rather than a hope.
 */
const TXN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function newTransactionId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TXN_ALPHABET[b % TXN_ALPHABET.length]).join("");
}

/** The six consents. create-sale requires every one of them to be true. */
const TERMS_KEYS = [
  "poaGoverned", "monitoring", "noResell",
  "emissionReductions", "noExport", "demonstration",
] as const;

export interface NormalizedRow {
  stoveSerialNo: string;
  salesDate: string;
  endUserName: string;
  phone: string;
  contactPerson: string;
  contactPhone: string;
  amount: number;
  amountReceived: number | null;
  state: string;
  lga: string;
  fullAddress: string;
  aka: string | null;
  otherPhone: string | null;
}

/**
 * Every header this importer recognises, by the field it feeds.
 *
 * Lifted out of normalizeRow so the mapping step can show an operator what is
 * understood and what is not. Before this, an unrecognised column was silently
 * ignored: the row imported, the field was empty, and nobody found out until
 * the call centre rang someone whose phone number had never arrived.
 */
export const HEADER_ALIASES: Record<string, string[]> = {
  stoveSerialNo: ["stove_serial_no", "Stove Serial Number", "serial", "stoveSerialNo", "Stove ID", "stove_id"],
  // Not a field on the sale: it is the transfer this stove went out on, and it
  // is carried so the import can check the row landed in the right sheet.
  transactionId: ["transaction_id", "Transaction ID", "sales_reference", "Sales Reference"],
  firstName:     ["first_name", "User First Name", "firstName"],
  lastName:      ["last_name", "User Last Name", "surname", "lastName", "endUserSurname"],
  endUserName:   ["end_user_name", "endUserName", "name"],
  phone:         ["phone", "Primary Phone Number", "primary_phone", "primaryPhone"],
  otherPhone:    ["other_phone", "Alternative Phone Number", "alt_phone", "otherPhone"],
  salesDate:     ["sales_date", "Sales Date", "date", "salesDate"],
  amount:        ["amount", "Sale Amount", "price", "saleAmount"],
  amountReceived:["amount_received", "Amount Received", "amountReceived"],
  state:         ["state", "State", "user_state", "state_backup", "stateBackup"],
  lga:           ["lga", "LGA", "Local Govt Area", "lga_backup", "lgaBackup"],
  fullAddress:   ["address", "User Residential Address", "full_address", "fullAddress"],
  contactPerson: ["contact_person", "Contact Person", "buyer", "contactPerson"],
  contactPhone:  ["contact_phone", "Contact Phone", "buyer_phone", "contactPhone"],
  aka:           ["aka", "AKA", "nickname"],

  // ---------------------------------------------------------------------
  // The rest of the sale, as the digitalisation sheet asks for it.
  //
  // The sheet is written from workflow_config and read by this table, and
  // until these existed it handed out eleven columns its own importer did
  // not recognise - so every digitiser met the column mapper every time,
  // for a file this module had just written. A sheet whose own headings
  // need mapping is not a template.
  // ---------------------------------------------------------------------
  partnerName:        ["partner_name", "Partner", "Partner Name", "partnerName"],
  // Not a field on the sale. It is read to price a row whose sheet has no
  // amount column, from the table in workflow_config.
  salesModel:         ["sales_model", "Sales Model", "salesModel"],
  salesRep:           ["sales_rep", "Sales Rep", "Sales Representative", "salesRep"],
  transferDate:       ["transfer_date", "Transfer Date", "transferDate"],
  potQuantity:        ["pot_quantity", "Pots Quantity", "Pot Quantity", "potQuantity"],
  heatRetentionDevice:["heat_retention_device", "Wonderbox", "Heat Retention Device",
                       "heatRetentionDevice"],
  previousStoveType:  ["previous_stove_type", "Previous Stove Type", "previousStoveType"],
  previousStoveOther: ["previous_stove_other", "Previous Stove (other)",
                       "Previous Stove Other", "previousStoveOther"],
  mealsPerDay:        ["meals_per_day", "Meals Per Day", "mealsPerDay"],
  cookingFuelSource:  ["cooking_fuel_source", "Fuel Source", "cookingFuelSource"],
  cookingLocation:    ["cooking_location", "Cooking Location", "cookingLocation"],
  termsAccepted:      ["terms_accepted", "All Terms Agreed", "Terms Agreed", "termsAccepted"],
};

/**
 * A spreadsheet says Yes and No; the database wants true and false.
 *
 * The sheet offers a dropdown of exactly "Yes" and "No" because those are what
 * a person reading a printed receipt writes, and TRUE in a cell is a formula
 * in some locales. The translation belongs here, at the one place a sheet
 * becomes a record.
 */
function yesNo(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1", "included"].includes(text)) return true;
  if (["no", "n", "false", "0", "none"].includes(text)) return false;
  return null;
}

/**
 * The sheet's own answers, turned into what create-sale expects.
 *
 * Applied before anything reads the row, so a workbook and a typed record
 * arrive in the same shape. "All Terms Agreed = Yes" becomes the six consents
 * the agreement carries; anything else leaves them alone, so a file that says
 * nothing about them falls through to the paper assertion rather than
 * asserting a No nobody wrote.
 */
export function fromSheetValues(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };

  const wonderbox = yesNo(out.heatRetentionDevice);
  if (wonderbox !== null) out.heatRetentionDevice = wonderbox;

  const terms = yesNo(out.termsAccepted);
  if (terms === true) {
    out.termsAccepted = Object.fromEntries(TERMS_KEYS.map((k) => [k, true]));
  } else if (terms === false) {
    out.termsAccepted = Object.fromEntries(TERMS_KEYS.map((k) => [k, false]));
  }

  // A dropdown gives the stored value already; a typed cell may not.
  if (typeof out.previousStoveType === "string") {
    const t = out.previousStoveType.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["charcoal", "wood_stove", "other"].includes(t)) out.previousStoveType = t;
  }

  return out;
}

/**
 * A thing that can be queried.
 *
 * `{ queryObject: (q: unknown) => ... }` was the shape both helpers declared,
 * and the real Client does not satisfy it: its queryObject is overloaded, and
 * an overload taking `string` is not assignable to one taking `unknown`. So
 * every call site type-errored, four of them, and the errors had been there
 * long enough to read as background noise.
 *
 * Named once and widened to what the driver actually offers.
 */
// deno-lint-ignore no-explicit-any
type Queryable = { queryObject: (...args: any[]) => Promise<{ rows: any[] }> };

/**
 * What one stove costs under a row's sales model.
 *
 * ONE RULE, WHATEVER THE CHANNEL.
 *
 * This started life inside the bulk validate step, which meant a Partner Sales
 * receipt in a FILE was priced automatically while the same receipt typed at
 * the bench was refused for having no amount. Two behaviours from one rule is
 * how the two paths drift, and the cheaper-looking one ends up accepting
 * records the other would have refused - which is the failure this module's
 * rules name explicitly.
 *
 * So it lives here and every entry path calls it: the file, the typed record
 * and the bench.
 *
 * Returns null when the model is unknown or unpriced, which is not an error.
 * The caller then refuses that one row with a reason naming the setting.
 */
export async function modelPriceFor(
  conn: Queryable,
  raw: Record<string, unknown>,
): Promise<number | null> {
  const model = field(raw, "salesModel").trim().toLowerCase();
  if (!model) return null;
  const r = await conn.queryObject({
    text: `select value from data_center.workflow_config where key = 'import.model_amounts'`,
  }) as { rows: { value: unknown }[] };
  const table = r.rows[0]?.value;
  if (!table || typeof table !== "object") return null;
  for (const [name, amount] of Object.entries(table as Record<string, unknown>)) {
    if (name.trim().toLowerCase() === model) {
      const n = Number(amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return null;
}

/** Which fields must be present for a row to be usable at all. */
export const REQUIRED_FIELDS = [
  "stoveSerialNo",
  // normalizeRow refuses a nameless row, and takes first plus last as
  // satisfying it. Leaving this off the list let `inspect` bless a file whose
  // every row would then be rejected, which is the exact silent failure this
  // step exists to close.
  //
  // `amount` is NOT here, and that is deliberate rather than an oversight. A
  // sheet may carry no amount column at all, because the price belongs to the
  // sales model; a row whose model has no price set is refused one row at a
  // time, with a reason naming where to set it. Demanding the column would
  // refuse the file before anybody saw which rows were priced.
  //
  // `lga` is not here either, matching normalizeRow, which records it and no
  // longer demands it.
  // `fullAddress` came off for the same reason as `lga`: it is worth having and
  // it is not what a record is for. The stove ID, the buyer's name, their
  // phone, the date and the state are.
  "endUserName", "phone", "salesDate", "state",
] as const;

function text(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * Put a file into the module's own vocabulary, using the aliases it already
 * knows, before anything looks at it.
 *
 * HEADER_ALIASES existed to drive the mapping screen and nothing else, so a
 * file whose serial column was headed "Stove ID" - the heading the transfer
 * sheet itself uses - reached the validator as an unrecognised column and the
 * row failed for having no serial. The alias table knew the answer and was
 * never asked.
 *
 * Case and punctuation are ignored when matching, because "Stove ID",
 * "stove id" and "Stove_ID" are the same column and only a computer thinks
 * otherwise.
 *
 * An explicit mapping from the operator still wins: they are looking at the
 * file and this is a guess, however good.
 */
const ALIAS_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    m.set(key(field), field);
    for (const alias of aliases) m.set(key(alias), field);
  }
  return m;
})();

export function autoMapRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [header, value] of Object.entries(row)) {
    const field = ALIAS_LOOKUP.get(header.toLowerCase().replace(/[^a-z0-9]/g, ""));
    // Never overwrite a value already sitting under the canonical name: a file
    // carrying both "phone" and "Primary Phone Number" keeps the canonical one.
    if (field && out[field] === undefined) out[field] = value;
  }
  return out;
}

/**
 * The fields create-sale accepts beyond the spine every row must have.
 *
 * The commit payload was a fixed list of thirteen, which was right while the
 * only way in was a spreadsheet of thirteen columns. The workbench collects
 * the whole form - the consents as actually ticked, the signature, the two
 * photographs, the stove set, the cooking habits, the payment model - and all
 * of it was being dropped between the row and the sale.
 *
 * Named explicitly rather than spread wholesale: a row's raw values come from
 * a file somebody else wrote, and forwarding whatever it happens to contain
 * into create-sale is how a column called `organizationId` in a partner's
 * spreadsheet ends up deciding whose sale it is.
 */
const PASSTHROUGH_FIELDS = [
  "signature",
  "stoveImageId",
  "agreementImageId",
  "retailerBranch",
  "potQuantity",
  "heatRetentionDevice",
  "previousStoveType",
  "previousStoveOther",
  "mealsPerDay",
  "cookingFuelSource",
  "cookingLocation",
  "isInstallment",
  "paymentModelId",
  "initialPaymentAmount",
  "initialPaymentMethod",
  "initialPaymentProofImageId",
] as const;

/** Whatever of the above this row actually carries, and nothing else. */
function passthroughFrom(source: Record<string, unknown> | null | undefined) {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of PASSTHROUGH_FIELDS) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

/**
 * The six consents.
 *
 * A row typed at the bench carries what the typist actually ticked, and that
 * is the truthful answer. A row from a spreadsheet has no such column, and
 * asserts them as accepted on paper, which is what the paper agreement is:
 * `import.require_paper_agreement` exists to make that assumption a setting
 * rather than a silent constant.
 */
function termsFrom(source: Record<string, unknown> | null | undefined) {
  const given = source?.termsAccepted;
  if (given && typeof given === "object") {
    const map = given as Record<string, unknown>;
    // Only accepted if every one is. A partly ticked agreement is not one.
    if (TERMS_KEYS.every((k) => map[k] === true)) {
      return Object.fromEntries(TERMS_KEYS.map((k) => [k, true]));
    }
    return map;
  }
  return Object.fromEntries(TERMS_KEYS.map((k) => [k, true]));
}

/**
 * The sales app's own field names, translated to the import's.
 *
 * Two vocabularies for one record. Sell Stove holds the address in a nested
 * `addressData` and the state in `stateBackup`, because that is what
 * create-sale takes; the import holds them flat, because that is what a
 * spreadsheet column is. Neither is wrong and neither is going to change, so
 * the bench translates at the seam.
 *
 * Found by testing the whole path rather than the pieces: every part worked
 * and a complete record was still refused for having no address, because the
 * address was sitting one level down under a different name.
 */
function fromSaleForm(values: Record<string, unknown>): Record<string, unknown> {
  const address = (values.addressData ?? {}) as Record<string, unknown>;
  const name = [values.endUserName, values.endUserSurname]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    ...values,
    endUserName: name || values.endUserName,
    state: values.state ?? values.stateBackup ?? address.state,
    lga: values.lga ?? values.lgaBackup ?? address.city,
    fullAddress: values.fullAddress ?? address.fullAddress,
  };
}

/**
 * Which partner does this file belong to?
 *
 * Nobody should have to answer that. The stove ID is printed on the stove and
 * every one of the 15,498 in stock carries both the partner it went to and the
 * transfer reference it went out on, so the file already knows. Asking the
 * operator to pick from a dropdown of 278 partners was asking them to repeat
 * something the data states, and to be wrong about it occasionally.
 *
 * Returns every partner the serials resolve to, so a file that spans two can
 * say which two rather than failing with a shrug. A serial that matches no
 * stock is not an error here: roughly one in twelve does not, that is the
 * normal case, and it belongs in the exceptions queue rather than stopping the
 * upload.
 *
 * The transfer reference, when the file carries one, is checked rather than
 * trusted. A row whose reference disagrees with the stock record is a row
 * somebody pasted into the wrong sheet, and it is named.
 */
async function resolvePartnersFromSerials(
  conn: Queryable,
  rows: Record<string, unknown>[],
): Promise<{
  partners: { organizationId: string; partnerName: string; branch: string | null; count: number }[];
  matched: number;
  unmatched: string[];
  mismatches: { serial: string; fileRef: string; stockRef: string }[];
}> {
  const serials: string[] = [];
  const refBySerial = new Map<string, string>();
  for (const row of rows) {
    // The row arrives already auto-mapped, so the canonical name is enough.
    const serial = text(row, "stoveSerialNo", ...HEADER_ALIASES.stoveSerialNo);
    if (!serial) continue;
    const up = serial.trim().toUpperCase();
    serials.push(up);
    const ref = text(row, "transactionId", ...HEADER_ALIASES.transactionId);
    if (ref) refBySerial.set(up, ref.trim().toUpperCase());
  }
  if (serials.length === 0) {
    return { partners: [], matched: 0, unmatched: [], mismatches: [] };
  }

  const found = await conn.queryObject({
    text: `select sb.stove_id, sb.organization_id::text, sb.sales_reference,
                  o.partner_name, o.branch
             from public.stove_ids_base sb
             left join public.organizations o on o.id = sb.organization_id
            where sb.stove_id = any($1::text[])`,
    args: [[...new Set(serials)]],
  }) as { rows: {
    stove_id: string;
    organization_id: string | null;
    sales_reference: string | null;
    partner_name: string | null;
    branch: string | null;
  }[] };

  const byId = new Map(found.rows.map((r) => [r.stove_id, r]));
  /*
   * Branch belongs in this summary, not only the name.
   *
   * A file covering two branches of one partner would otherwise report
   * "Twin Name Partner (1), Twin Name Partner (1)", which reads as a bug in
   * the counting rather than as two real partners. Production has four rows
   * called LAPO and four called Solar Sister, so this is the normal case there,
   * not an edge one.
   */
  const counts = new Map<
    string,
    { partnerName: string; branch: string | null; count: number }
  >();
  const unmatched: string[] = [];
  const mismatches: { serial: string; fileRef: string; stockRef: string }[] = [];
  let matched = 0;

  for (const serial of serials) {
    const hit = byId.get(serial);
    if (!hit || !hit.organization_id) {
      unmatched.push(serial);
      continue;
    }
    matched++;
    const entry = counts.get(hit.organization_id) ??
      {
        partnerName: hit.partner_name ?? "Unnamed partner",
        branch: hit.branch ?? null,
        count: 0,
      };
    entry.count++;
    counts.set(hit.organization_id, entry);

    const fileRef = refBySerial.get(serial);
    if (fileRef && hit.sales_reference && fileRef !== hit.sales_reference.toUpperCase()) {
      mismatches.push({ serial, fileRef, stockRef: hit.sales_reference });
    }
  }

  return {
    partners: [...counts.entries()]
      .map(([organizationId, v]) => ({ organizationId, ...v }))
      .sort((a, b) => b.count - a.count),
    matched,
    unmatched: [...new Set(unmatched)],
    mismatches,
  };
}

/**
 * One field, read by its canonical name and every alias the module knows.
 *
 * `normalizeRow` listed its own aliases at each call site, and the lists were
 * not the same as HEADER_ALIASES. `otherPhone` was the one that showed: the
 * alias table says `otherPhone` is the canonical name, the call site asked for
 * `other_phone`, `Alternative Phone Number` and `alt_phone`, and a form that
 * sends the canonical name had its value dropped in silence.
 *
 * Exactly the shape of the "Stove ID" bug a few commits earlier - a table that
 * knows the answer and a reader that does not ask it. Asking it here means a
 * new alias is one edit, in the table, and every reader gets it.
 */
function field(raw: Record<string, unknown>, key: keyof typeof HEADER_ALIASES, ...extra: string[]) {
  return text(raw, key as string, ...(HEADER_ALIASES[key] ?? []), ...extra);
}

/**
 * Turn one spreadsheet row into something create-sale would accept, or explain
 * why it cannot be.
 *
 * Returns the reason as a sentence rather than a code. The person reading it is
 * a data clerk with the receipt in front of them, not a developer.
 */
export function normalizeRow(
  raw: Record<string, unknown>,
  /**
   * Values to fall back on when the file does not carry them.
   *
   * Only `amount` today, and only when the row has none. A sheet written for
   * digitisation records what was sold, not what it cost, because the price is
   * a property of the sales model rather than of the receipt. The alternative
   * was writing the price into `raw`, and `raw` is what a rejected row is shown
   * as - the version the person fixing it recognises - so it stays as typed.
   */
  defaults: { amount?: number | null } = {},
):
  // `hint` says what to do about it. A reason without a fix leaves a digitiser
  // with four hundred rows and no next step, which is how a rejection file gets
  // ignored rather than corrected.
  | { ok: true; row: NormalizedRow; warning?: string | null }
  | { ok: false; reason: string; hint?: string } {
  const serial = field(raw, "stoveSerialNo");
  if (!serial) {
    return {
      ok: false,
      reason: "No stove serial number",
      hint:
        "Every row needs the stove ID printed on the stove. It is the only thing that ties this sale to a partner, so a row without one cannot be placed.",
    };
  }

  const firstName = field(raw, "firstName");
  const lastName = field(raw, "lastName");
  const combined = field(raw, "endUserName");
  const endUserName = combined || [firstName, lastName].filter(Boolean).join(" ").trim();
  if (!endUserName) {
    return {
      ok: false,
      reason: "No end user name",
      hint:
        "Fill in the buyer's name, either as one Name column or as First name and Last name.",
    };
  }

  // Normalised rather than merely checked. A spreadsheet writes the same
  // number half a dozen ways and Excel eats the leading zero of any column it
  // decides is numeric, so refusing anything but 0XXXXXXXXXX rejects work that
  // is not wrong. One shape goes in, whatever shape came out of the file.
  const phoneRaw = field(raw, "phone");
  const phoneResult = normalizeNigerianPhone(phoneRaw);
  if (!phoneResult.ok) {
    return { ok: false, reason: phoneResult.reason, hint: phoneResult.hint };
  }
  const cleanedPhone = phoneResult.phone;

  const salesDateRaw = field(raw, "salesDate");
  if (!salesDateRaw) {
    return {
      ok: false,
      reason: "No sale date",
      hint: "Add the date on the receipt, as 2026-07-14 or 14/07/2026.",
    };
  }
  // Accept both ISO and the DD/MM/YYYY a spreadsheet usually produces.
  let salesDate = salesDateRaw;
  if (!ISO_DATE.test(salesDate)) {
    const serial = excelSerialToIso(salesDate);
    if (serial) salesDate = serial;
  }
  if (!ISO_DATE.test(salesDate)) {
    const m = salesDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) {
      return {
        ok: false,
        reason: `Sale date "${salesDateRaw}" is not a date we recognise`,
        hint:
          "Write it as 2026-07-14 or 14/07/2026. A date typed in Excel is understood " +
          "even when the spreadsheet shows it as a number.",
      };
    }
    salesDate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (Number.isNaN(Date.parse(salesDate))) {
    return {
      ok: false,
      reason: `Sale date "${salesDateRaw}" is not a real date`,
      hint:
        "Check the day and month are not swapped: 14/07/2026 is the 14th of July, not the 7th of the 14th month.",
    };
  }

  const amountRaw = field(raw, "amount");
  const priced = typeof defaults.amount === "number" && defaults.amount > 0;
  const amount = amountRaw.trim() === "" && priced
    ? (defaults.amount as number)
    : Number(amountRaw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      reason: amountRaw.trim() === ""
        ? "No sale amount, and this row's sales model has no price set"
        : `Sale amount "${amountRaw}" is not a number above zero`,
      hint: amountRaw.trim() === ""
        ? "Either add a Sale Amount column to the sheet, or set a price for this " +
          "sales model in Settings so every row on that model is priced the same."
        : "Enter digits only, like 47500. Leave out the naira sign and any commas, and do not write 'cash' or 'paid'.",
    };
  }

  const receivedRaw = field(raw, "amountReceived");
  const amountReceived = receivedRaw === "" ? null : Number(receivedRaw.replace(/[^0-9.]/g, ""));
  if (amountReceived !== null && (!Number.isFinite(amountReceived) || amountReceived < 0)) {
    return {
      ok: false,
      reason: `Amount received "${receivedRaw}" is not a number`,
      hint:
        "Enter digits only, like 20000. If nothing has been paid yet, leave the cell empty rather than writing 0.00 or 'nil'.",
    };
  }
  if (amountReceived !== null && amountReceived > amount) {
    return {
      ok: false,
      reason: "Amount received is greater than the sale amount",
      hint:
        "Check the two figures are the right way round. If the buyer really overpaid, record the sale amount as what they actually paid.",
    };
  }

  const state = field(raw, "state", "stateBackup");
  if (!state) {
    return {
      ok: false,
      reason: "No state",
      hint: "Add the buyer's state, spelled out, like Gombe or Kano.",
    };
  }
  /*
   * LGA is recorded when the file has it, and never demanded.
   *
   * A digitisation sheet is typed from a paper receipt and the LGA is often
   * not on it: on the real file every one of 983 rows is blank, because the
   * only "Local Govt Area" column belongs to the CALL CENTRE half of the
   * sheet, where it is confirmed with the end user on the phone. Refusing 983
   * good rows for a field the digitiser was never given, which the call pass
   * is about to supply, is the check costing more than it catches.
   *
   * State is still required. It is on the receipt, it is on the sheet, and it
   * is what the scorecards cut by.
   */
  const lga = field(raw, "lga", "lgaBackup");

  /*
   * The address is recorded when the file has it, and never demanded.
   *
   * The stove ID is what a record is FOR: it is the thing that ties a buyer to
   * a stove, a partner and a carbon claim, and it is the one column that can be
   * checked against something. An address is worth having and can be filled in
   * afterwards from the call the call centre is about to make; refusing a row
   * that names a real stove and a real buyer because the receipt had no street
   * loses the record entirely to gain a field somebody will supply next week.
   *
   * 140 rows of the first real file are exactly this: named buyer, real phone,
   * real stove, no address written on the receipt.
   *
   * `create-sale` does not require it either, and public.addresses accepts a
   * blank row - production already holds two.
   */
  const fullAddress = field(raw, "fullAddress");

  // The buyer defaults to the end user, which is what a receipt with one name
  // on it means.
  const contactPerson = field(raw, "contactPerson") || endUserName;
  const contactPhoneRaw = field(raw, "contactPhone") || cleanedPhone;
  const contactResult = normalizeNigerianPhone(contactPhoneRaw);
  if (!contactResult.ok) {
    return {
      ok: false,
      reason: `Contact phone: ${contactResult.reason}`,
      hint: contactResult.hint,
    };
  }
  const contactPhone = contactResult.phone;

  // The alternative number is optional, so a bad one is dropped rather than
  // failing the row: refusing an otherwise complete sale over a spare number
  // nobody has rung yet costs more than it saves. It is reported as a warning
  // on the batch instead.
  const otherPhoneRaw = field(raw, "otherPhone");
  const otherResult = otherPhoneRaw ? normalizeNigerianPhone(otherPhoneRaw) : null;
  const otherPhone = otherResult?.ok ? otherResult.phone : null;
  const otherPhoneWarning = otherPhoneRaw && !otherResult?.ok
    ? `Alternative phone "${otherPhoneRaw}" was not usable and has been left out`
    : null;

  return {
    ok: true,
    row: {
      stoveSerialNo: serial.toUpperCase(),
      salesDate,
      endUserName,
      phone: cleanedPhone,
      contactPerson,
      contactPhone,
      amount,
      amountReceived,
      state,
      lga,
      fullAddress,
      aka: field(raw, "aka") || null,
      otherPhone,
    },
    warning: otherPhoneWarning,
  };
}

// ---------------------------------------------------------------------------

/**
 * A stable fingerprint of a file's contents.
 *
 * Over the parsed rows rather than the file bytes, so re-saving a spreadsheet
 * without changing anything in it still matches. Keys are sorted because two
 * exports of the same sheet can order columns differently and still be the
 * same data.
 */
async function contentHash(rows: Record<string, unknown>[]): Promise<string> {
  const canonical = JSON.stringify(
    rows.map((r) =>
      Object.keys(r)
        .sort()
        .map((k) => [k, r[k] === null || r[k] === undefined ? "" : String(r[k]).trim()]),
    ),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * May this caller stage against this partner at all?
 *
 * The module's rule is role AND feature AND organization scope, and staging
 * checked only the first two: `organizationId` arrived from the client and was
 * written down. Validate limited the damage, since a stove belonging to
 * someone else becomes an exception, but a batch could still be filed under a
 * partner the caller has nothing to do with.
 *
 * The question is the same one the `partners` action answers, asked of one
 * organization instead of listing them all.
 *
 * Scope comes from public.acsl_agent_org_scope, the one definition of the
 * rule. This used to read acsl_agent_organizations directly, which is only
 * half of it: an agent covered by state holds no named partners, so this
 * resolved them to nothing and refused every import they attempted. It was
 * invisible only because everyone was materialised into named rows.
 *
 * Own coverage, not the team's. That is faithful to what this did before, and
 * widening a manager to their subordinates' partners is a separate decision
 * from fixing the state hole. Worth knowing that create-sale does include
 * subordinates, so the two are not identical; that inconsistency predates this
 * change and is left where it was rather than quietly settled here.
 */
async function organizationInScope(
  conn: PoolClient,
  userId: string,
  ownOrganizationId: string | null,
  organizationId: string,
): Promise<boolean> {
  const r = await conn.queryObject<{ ok: boolean }>({
    text: `select exists (
             select 1 from public.organizations o
              where o.id = $3
                and (o.id = $2
                     or o.id in (select organization_id
                                   from public.acsl_agent_org_scope(array[$1::uuid])))
           ) as ok`,
    args: [userId, ownOrganizationId, organizationId],
  });
  return r.rows[0]?.ok === true;
}

/**
 * Which of these partners is this caller NOT allowed to import for?
 *
 * The singular version asked once per partner, and each ask opened its own
 * connection. The first real digitisation file covers fifty partners, so the
 * upload made fifty sequential connections and hit the client's twenty-second
 * timeout before a single row was staged.
 *
 * The module's own notes say it plainly: a round trip from an edge function to
 * Postgres costs far more than the query does, so the number of statements per
 * request is the thing worth minimising. Fifty partners is one question.
 *
 * Returns the ids out of scope, because that is what the caller has to say out
 * loud, and an empty array is the answer that lets the import proceed.
 */
async function organizationsOutOfScope(
  conn: PoolClient,
  userId: string,
  ownOrganizationId: string | null,
  organizationIds: string[],
): Promise<string[]> {
  if (organizationIds.length === 0) return [];
  const r = await conn.queryObject<{ id: string }>({
    text: `select o.id::text as id
             from unnest($3::uuid[]) as o(id)
            where not exists (
              select 1 from public.organizations x
               where x.id = o.id
                 and (x.id = $2
                      or x.id in (select organization_id
                                    from public.acsl_agent_org_scope(array[$1::uuid])))
            )`,
    args: [userId, ownOrganizationId, organizationIds],
  });
  return r.rows.map((x) => x.id);
}

async function readConfig(conn: PoolClient, key: string, fallback: unknown) {
  const r = await conn.queryObject<{ value: unknown }>({
    text: "select value from data_center.workflow_config where key = $1",
    args: [key],
  });
  return r.rows[0]?.value ?? fallback;
}

serve(async (req) => {
  const cors = resolveCors(req);
  const requestOrigin = req.headers.get("Origin") ?? "";
  if (!originAllowed(requestOrigin)) {
    return json({ error: "Origin not permitted", code: "bad_origin" }, 403, cors);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405, cors);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization header", code: "no_token" }, 401, cors);
    }
    const token = authHeader.slice("Bearer ".length);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user) {
      return json({ error: "Unauthorized", code: "invalid_token" }, 401, cors);
    }
    const userId = auth.user.id;

    const { data: profile } = await supabase
      .from("profiles").select("role, organization_id").eq("id", userId).single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }
    const superAdmin = profile.role === "super_admin";

    let body: { action?: string; [key: string]: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    // Two separate grants, deliberately. Uploading and validating is clerical;
    // committing changes live inventory. import.commit is never implied by an
    // access level and has to be granted on its own.
    const features = superAdmin ? null : await withReadConnection(async (conn) => {
      const r = await conn.queryObject<{ access_role: string | null; keys: string[] | null }>({
        text: `select
                 (select access_role from data_center.module_access where user_id = $1) as access_role,
                 (select coalesce(array_agg(feature_key), '{}')
                    from data_center.feature_grants where user_id = $1) as keys`,
        args: [userId],
      });
      const accessRole = r.rows[0]?.access_role ?? null;
      if (!accessRole) return null;
      return featuresFor(accessRole, r.rows[0]?.keys ?? []);
    });

    if (!superAdmin && features === null) {
      return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
    }
    const can = (key: string) => superAdmin || (features ?? []).includes(key);

    const requireFeature = (key: string) => {
      if (!can(key)) throw new BadRequest(`This needs the ${key} permission`);
    };

    /**
     * A super admin may stage against anyone; everyone else against their own
     * organization and the partners assigned to them as an ACSL agent. The
     * same rule the `partners` picker follows, enforced rather than assumed,
     * because the picker is presentation and the id arrives from the client.
     */
    const requireOrganization = async (organizationId: string) => {
      if (superAdmin) return;
      const allowed = await withReadConnection((conn) =>
        organizationInScope(conn, userId, profile.organization_id ?? null, organizationId)
      );
      if (!allowed) {
        throw new BadRequest("That partner is not one you can import for");
      }
    };

    switch (body.action) {
      /**
       * Stage a parsed file. The client does the CSV parsing, so an unreadable
       * file is a problem the operator sees immediately rather than a batch
       * that fails server-side minutes later.
       */
      /**
       * What the importer makes of a file's headers, before anything is staged.
       *
       * The step that did not exist. An unrecognised column used to be ignored
       * in silence, so a file whose phone column was called something unusual
       * imported cleanly with no phone numbers in it, and the first anyone knew
       * was the call centre having nobody to ring.
       *
       * Now the operator sees which headers are understood, which are not, and
       * which required fields nothing feeds, and maps the strays before staging.
       */
      case "inspect": {
        requireFeature("import.upload");
        const headers = (body.headers ?? []) as string[];
        if (!Array.isArray(headers) || headers.length === 0) {
          throw new BadRequest("No headers to inspect");
        }

        const normalised = (h: string) => h.trim().toLowerCase();
        const known = new Map<string, string>();
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
          for (const alias of aliases) known.set(normalised(alias), field);
        }

        const recognised: { header: string; field: string }[] = [];
        const unrecognised: string[] = [];
        for (const h of headers) {
          const field = known.get(normalised(h));
          if (field) recognised.push({ header: h, field });
          else unrecognised.push(h);
        }

        const fed = new Set(recognised.map((r) => r.field));
        // first/last name together stand in for the combined name.
        if (fed.has("firstName") || fed.has("lastName")) fed.add("endUserName");
        const missing = REQUIRED_FIELDS.filter((f) => !fed.has(f));

        return json(
          {
            data: {
              recognised,
              unrecognised,
              missingRequired: missing,
              mappableFields: Object.keys(HEADER_ALIASES),
              maxRows: Number(
                await withReadConnection((c) => readConfig(c, "import.max_rows", 20000)),
              ) || 20000,
            },
          },
          200,
          cors,
        );
      }

      case "stage": {
        requireFeature("import.upload");
        const incoming = body.rows as Record<string, unknown>[] | undefined;
        const organizationId = String(body.organizationId ?? "");
        const mapping = (body.columnMapping ?? {}) as Record<string, string>;
        const source = ["receipt", "manual", "field"].includes(String(body.source))
          ? String(body.source)
          : "receipt";

        if (!Array.isArray(incoming) || incoming.length === 0) {
          throw new BadRequest("No rows to import");
        }
        const maxRows = Number(
          await withReadConnection((c) => readConfig(c, "import.max_rows", 20000)),
        ) || 20000;
        if (incoming.length > maxRows) {
          throw new BadRequest(
            `That file has ${incoming.length} rows and the limit is ${maxRows}. Split it.`,
          );
        }
        /**
         * One vocabulary, before anything reads a row.
         *
         * The operator's mapping first, because they are looking at the file.
         * Then the alias table fills in whatever they did not name, which is
         * usually everything: the sheet this module hands out already uses
         * headings the aliases know.
         *
         * `raw` is untouched by both. A rejected row is shown exactly as it was
         * typed, which is the only version the person fixing it recognises.
         */
        const preMapped = incoming.map((row) => {
          const copy: Record<string, unknown> = { ...row };
          for (const [header, field] of Object.entries(mapping)) {
            if (field && row[header] !== undefined) copy[field] = row[header];
          }
          return fromSheetValues(autoMapRow(copy));
        });

        /**
         * The partner comes from the file, not from a dropdown.
         *
         * An explicit organizationId is still honoured, because manual entry
         * sends one and a caller may want to pin a batch deliberately. Left
         * out, the serials decide.
         */
        let resolvedOrgId = organizationId;
        let resolution: Awaited<ReturnType<typeof resolvePartnersFromSerials>> | null = null;

        if (!resolvedOrgId) {
          resolution = await withReadConnection((c) => resolvePartnersFromSerials(c, preMapped));

          if (resolution.partners.length === 0) {
            throw new BadRequest(
              "None of the stove IDs in this file match stock we hold, so there is no way to tell " +
                "which partner it belongs to. Check the Stove ID column is the one from the " +
                "transfer sheet, and that it has not been shortened or had its leading zeros " +
                "removed by the spreadsheet.",
            );
          }

          /*
           * A file may cover several partners.
           *
           * It used to be refused, on the reasoning that a batch should roll
           * back without touching anybody else's records. That reasoning holds
           * and this keeps it: the batch is still one batch and still rolls
           * back whole. What changes is that the partner is a property of the
           * ROW rather than of the batch, decided by the stove ID, which is the
           * only thing in the file that can be checked against something.
           *
           * Every partner in the file is scope-checked, not just the first.
           * Staging a sheet that happens to contain one row for a partner you
           * do not cover must be refused, and checking only the majority
           * partner would let that row through.
           */
          //
          // ONE question for all of them. This was a loop calling the singular
          // check, and each call opened its own connection: the first real file
          // covers fifty partners, so the upload made fifty sequential
          // connections and hit the client's twenty-second timeout before a
          // single row was staged.
          const found = resolution.partners;
          if (!superAdmin) {
            const ids = found.map((x) => x.organizationId);
            const denied: string[] = await withReadConnection((c) =>
              organizationsOutOfScope(c, userId, profile.organization_id ?? null, ids)
            );
            if (denied.length > 0) {
              const named = found
                .filter((x) => denied.includes(x.organizationId))
                .map((x) => [x.partnerName, x.branch].filter(Boolean).join(", "))
                .slice(0, 5);
              throw new BadRequest(
                `This file covers ${denied.length === 1 ? "a partner" : `${denied.length} partners`} ` +
                  `you cannot import for: ${named.join("; ")}` +
                  (denied.length > named.length ? ", and others" : "") +
                  ". Remove those rows, or ask for the partner to be assigned to you.",
              );
            }
          }

          /*
           * One partner still pins the batch, which keeps every existing
           * reading of `import_batches.organization_id` true. Several leaves it
           * null, and the rows carry it instead.
           */
          resolvedOrgId = resolution.partners.length === 1
            ? resolution.partners[0].organizationId
            : "";
        }

        if (resolvedOrgId) await requireOrganization(resolvedOrgId);

        // Apply the operator's header mapping before anything else, so
        // everything downstream sees one vocabulary. A mapped column is copied
        // rather than renamed: `raw` stays exactly as the file had it, which is
        // what lets a rejected row be shown as it was typed.
        const rows = preMapped;

        const hash = await contentHash(rows);
        const warnOnDuplicate = Boolean(
          await withReadConnection((c) => readConfig(c, "import.warn_on_duplicate_upload", true)),
        );

        // A repeat upload warns and stops; asking again with `confirmDuplicate`
        // goes ahead. Never a hard block: a partner can legitimately return the
        // same serials after a correction, and refusing that outright would
        // send someone to edit the file until it was accepted.
        if (warnOnDuplicate && !body.confirmDuplicate) {
          const previous = await withReadConnection(async (conn) => {
            // Scoped to the same partner. A repeat means "this partner sent
            // this again", and an unscoped lookup would answer with another
            // organization's filename and date to someone who may not see it.
            const r = await conn.queryObject<{ id: string; state: string; uploaded_at: string; filename: string | null }>({
              text: `select id::text, state, uploaded_at, filename
                     from data_center.import_batches
                     where content_hash = $1
                       and organization_id is not distinct from $2::uuid
                     order by uploaded_at desc limit 1`,
              // Null, not empty: a mixed-partner batch has no organization, and
              // '' is not a uuid, which Postgres refuses rather than treating as
              // "no partner". `is not distinct from` is what makes null match
              // null, so re-uploading the same mixed file is still caught.
              args: [hash, resolvedOrgId || null],
            });
            return r.rows[0] ?? null;
          });
          if (previous) {
            return json(
              {
                error:
                  `This file was already staged on ${new Date(previous.uploaded_at).toLocaleDateString()}` +
                  `${previous.filename ? ` as "${previous.filename}"` : ""} and that batch is ${previous.state}. ` +
                  "Upload it again only if you mean to.",
                code: "duplicate_upload",
                data: { previousBatchId: previous.id, state: previous.state },
              },
              409,
              cors,
            );
          }
        }

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const batch = await conn.queryObject<{ id: string }>({
              text: `insert into data_center.import_batches
                       (source, filename, uploaded_by, organization_id, total_rows, state,
                        content_hash, column_mapping, source_note)
                     values ($5, $1, $2, $3, $4, 'staged', $6, $7::jsonb, $8) returning id`,
              args: [
                // Null rather than empty: a mixed batch belongs to no one
                // partner, and the column is nullable for exactly that.
                body.filename ?? null, userId, resolvedOrgId || null, rows.length,
                source, hash,
                JSON.stringify(mapping),
                body.sourceNote ?? null,
              ],
            });
            const batchId = batch.rows[0].id;

            // One statement for the whole file. Row by row would be thousands
            // of round trips for a file an operator is watching.
            await conn.queryObject({
              text: `insert into data_center.import_rows (batch_id, row_number, raw)
                     select $1, ordinality, value
                     from jsonb_array_elements($2::jsonb) with ordinality`,
              args: [batchId, JSON.stringify(rows)],
            });
            await conn.queryObject("commit");
            return json(
              {
                data: {
                  batchId,
                  totalRows: rows.length,
                  // Stated rather than assumed: the operator picked nothing, so
                  // the page has to show what the file turned out to be.
                  resolvedPartner: resolution
                    ? {
                      organizationId: resolvedOrgId || null,
                      /*
                       * The whole list, not the first of it.
                       *
                       * When a file covered one partner this was that partner's
                       * name, and it still is. When it covers three, naming one
                       * of them is worse than naming none: the operator reads
                       * it as what the file is and only finds out otherwise
                       * from where the sales ended up.
                       */
                      partnerName: resolution.partners.length === 1
                        ? (resolution.partners[0]?.partnerName ?? null)
                        : null,
                      partners: resolution.partners.map((p) => ({
                        organizationId: p.organizationId,
                        partnerName: p.partnerName,
                        branch: p.branch ?? null,
                        count: p.count,
                      })),
                      matched: resolution.matched,
                      unmatched: resolution.unmatched.length,
                      mismatches: resolution.mismatches.slice(0, 20),
                    }
                    : null,
                },
              },
              200,
              cors,
            );
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * One record, typed rather than uploaded.
       *
       * A file is the normal case, and it is not the only one. A receipt turns
       * up on its own, or a rejected row needs re-keying, and building a
       * one-line spreadsheet to import it is a workaround people do not
       * perform: they write it on a sticky note instead.
       *
       * It is a batch of one, deliberately. Same validator, same stock check,
       * same exceptions queue, same commit path, same audit trail. A second
       * write path with its own rules is how the two drift apart, and the
       * cheaper-looking version is the one that ends up accepting records the
       * file path would have refused.
       */
      case "manual_entry": {
        requireFeature("import.upload");
        const rawRecord = body.record as Record<string, unknown> | undefined;
        if (!rawRecord || typeof rawRecord !== "object") throw new BadRequest("No record given");
        // Same auto-mapping a file gets. One validator, whatever the channel.
        const record = fromSheetValues(autoMapRow(rawRecord));

        /**
         * The serial names the partner here too.
         *
         * A typed record is a batch of one through the same path, so it
         * resolves the same way rather than asking a question the file is not
         * asked. An explicit organizationId still wins, for a caller that has
         * one.
         */
        let organizationId = String(body.organizationId ?? "");
        if (!organizationId) {
          const found = await withReadConnection((c) => resolvePartnersFromSerials(c, [record]));
          if (found.partners.length !== 1) {
            throw new BadRequest(
              found.partners.length === 0
                ? "That stove ID does not match any stock we hold, so there is no way to tell " +
                  "which partner this sale belongs to. Check the ID against the transfer sheet."
                : "That stove ID matches more than one partner, which should not happen. " +
                  "Report it rather than working around it.",
            );
          }
          organizationId = found.partners[0].organizationId;
        }
        await requireOrganization(organizationId);

        // Fail on the shape before writing anything. A file gets staged first
        // because the operator wants to see all the failures at once; a single
        // record is better answered immediately.
        //
        // Priced by the same rule a file is. One validator, whatever the
        // channel, and that has to include what the validator is given.
        const typedPrice = await withReadConnection((c) => modelPriceFor(c, record));
        const shape = normalizeRow(record, { amount: typedPrice });
        if (!shape.ok) {
          throw new BadRequest(shape.hint ? `${shape.reason}. ${shape.hint}` : shape.reason);
        }

        const hash = await contentHash([record]);

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const batch = await conn.queryObject<{ id: string }>({
              text: `insert into data_center.import_batches
                       (source, filename, uploaded_by, organization_id, total_rows, state,
                        content_hash, source_note)
                     values ('manual', null, $1, $2, 1, 'staged', $3, $4) returning id`,
              args: [userId, organizationId, hash, body.sourceNote ?? null],
            });
            const batchId = batch.rows[0].id;
            await conn.queryObject({
              text: `insert into data_center.import_rows (batch_id, row_number, raw)
                     values ($1, 1, $2::jsonb)`,
              args: [batchId, JSON.stringify(record)],
            });
            await conn.queryObject("commit");
            return json({ data: { batchId, totalRows: 1 } }, 200, cors);
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * Validate every staged row and match it against stock.
       *
       * A serial that does not match becomes an EXCEPTION, not a rejection.
       * Roughly 8% of real serials miss, including malformed ones like `10110`
       * against a nine digit norm, and a human with the receipt can usually
       * fix them. Treating that as failure would throw away one row in twelve.
       */
      case "validate": {
        requireFeature("import.upload");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const batchRow = await conn.queryObject<{ organization_id: string }>({
              text: "select organization_id from data_center.import_batches where id = $1 for update",
              args: [batchId],
            });
            if (batchRow.rows.length === 0) throw new BadRequest("No such batch");
            const orgId = batchRow.rows[0].organization_id;

            const pending = await conn.queryObject<
              { id: string; row_number: number; raw: Record<string, unknown> }
            >({
              text: `select id, row_number, raw from data_center.import_rows
                     where batch_id = $1 and status in ('pending','valid','rejected','exception')
                     order by row_number`,
              args: [batchId],
            });

            // Shape each row first, then ask the database once which of the
            // serials exist. One query for the whole batch rather than one per
            // row, which at 20,000 rows is the difference between seconds and
            // an afternoon.
            /*
             * The price table, read once for the batch rather than once per row.
             *
             * modelPriceFor is the rule and is what the single-record paths
             * call; a file of four hundred rows would ask the same question
             * four hundred times, so the answer is cached here. Same table,
             * same matching, one place to change either.
             */
            const priceRow = await conn.queryObject<{ value: unknown }>({
              text: `select value from data_center.workflow_config
                      where key = 'import.model_amounts'`,
            });
            const prices = new Map<string, number>();
            const rawPrices = priceRow.rows[0]?.value;
            if (rawPrices && typeof rawPrices === "object") {
              for (const [model, amount] of Object.entries(rawPrices as Record<string, unknown>)) {
                const n = Number(amount);
                if (Number.isFinite(n) && n > 0) prices.set(model.trim().toLowerCase(), n);
              }
            }
            const priceOf = (raw: Record<string, unknown>) => {
              const model = field(raw, "salesModel").trim().toLowerCase();
              return model ? (prices.get(model) ?? null) : null;
            };

            const shaped = pending.rows.map((r) => ({
              id: r.id,
              rowNumber: Number(r.row_number),
              // Kept, because the columns the system filled in are checked
              // against the stove ID below and normalizeRow does not carry them.
              raw: r.raw,
              result: normalizeRow(r.raw, { amount: priceOf(r.raw) }),
            }));
            const serials = shaped
              .filter((s) => s.result.ok)
              .map((s) => (s.result as { ok: true; row: NormalizedRow }).row.stoveSerialNo);

            const stock = await conn.queryObject<{
              stove_id: string;
              status: string;
              organization_id: string;
              partner_id: string | null;
              partner_name: string | null;
            }>({
              // The partner comes along for the ride. It is what lets a file
              // covering several partners be previewed row by row, and what
              // commit checks its own answer against.
              text: `select sb.stove_id, sb.status, sb.organization_id,
                            o.partner_id, o.partner_name
                       from public.stove_ids_base sb
                       left join public.organizations o on o.id = sb.organization_id
                      where upper(sb.stove_id) = any($1::text[])`,
              args: [[...new Set(serials)]],
            });
            const byStoveId = new Map(stock.rows.map((s) => [s.stove_id.toUpperCase(), s]));

            // Which transfer each serial came from. The same chain the funnel
            // uses, asked once for the whole batch, so a record and Partner
            // Records can never disagree about which consignment a sale
            // belongs to. Roughly one serial in twelve matches nothing, which
            // is why the column is nullable rather than the join being a
            // condition of import.
            const transfers = await conn.queryObject<{
              stove_id: string;
              transaction_id: string;
              sales_rep: string | null;
            }>({
              text: `select ts.stove_id, ts.transaction_id, f.sales_rep
                       from data_center.v_transfer_stoves ts
                       left join data_center.transfer_funnel f
                              on f.transfer_id = ts.transfer_id
                      where ts.stove_id = any($1::text[])`,
              args: [[...new Set(serials)]],
            });
            const transferBySerial = new Map(
              transfers.rows.map((t) => [t.stove_id, t.transaction_id]),
            );
            const repBySerial = new Map(
              transfers.rows.map((t) => [t.stove_id, t.sales_rep]),
            );

            // The same serial twice in one file. It used to import twice: the
            // first row took the stove and the second failed at commit with a
            // stove-already-sold error, which reads as a stock problem rather
            // than a typing one. Naming the row it duplicates is what makes it
            // fixable.
            const firstSeen = new Map<string, number>();

            /**
             * Every verdict decided in memory, then written in one statement.
             *
             * The lookups above were already batched - one query for stock,
             * one for transfers - but the verdicts were written back a row at
             * a time, and each of those is a network round trip from the edge
             * runtime to Postgres. Measured against the preview: 200 rows took
             * 22.2 seconds, past the client's own 20-second abort, so a sheet
             * this module hands out could not be validated through the UI at
             * all. At the 500,000 rows this module is built for it would be
             * about fifteen hours.
             *
             * `jsonb_to_recordset` turns the whole set of verdicts into rows
             * Postgres can join against, which makes the write one statement
             * regardless of batch size. This is the same shape the staging
             * insert already uses.
             */
            type Verdict = {
              id: string;
              status: "rejected" | "exception" | "valid";
              rejection_reason: string | null;
              rejection_hint: string | null;
              exception_reason: string | null;
              stove_serial_no: string | null;
              normalized: string | null;
              transaction_id: string | null;
              duplicate_of_row: number | null;
              /** Stoves already on this row's number. Amber, never a block. */
              shared_phone_with: string[] | null;
            };

            const verdicts: Verdict[] = [];
            /**
             * Which of these numbers is already carrying a stove.
             *
             * One household with one number and two stoves is allowed on this
             * path, so this never refuses a row - it marks it, so the person
             * who can tell a family from a mistyped digit is looking at both
             * stoves before anything commits. Without it the sheet validates
             * clean and then fails at commit one row at a time, with the
             * reason arriving long after the rows that caused it.
             *
             * The tail is the comparison key create-sale uses, which is also
             * what idx_sales_phone_tail is built on, so this is an index
             * lookup rather than a scan.
             */
            const tailOf = (v: string | null | undefined) =>
              String(v ?? "").replace(/\D+/g, "").slice(-10);

            const tails = new Map<string, string[]>();
            for (const item of shaped) {
              if (!item.result.ok) continue;
              const tail = tailOf((item.result as { ok: true; row: NormalizedRow }).row.phone);
              if (tail.length === 10) tails.set(tail, []);
            }

            if (tails.size > 0) {
              const live = await conn.queryObject<{ tail: string; stove_serial_no: string }>({
                text: `select right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) as tail,
                              s.stove_serial_no
                         from public.sales s
                        where s.is_archived is not true
                          and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10)
                              = any($1::text[])`,
                args: [[...tails.keys()]],
              });
              for (const row of live.rows) {
                tails.get(row.tail)?.push(row.stove_serial_no);
              }
            }

            // And the same number twice inside this one file, which the query
            // above cannot see because neither row is a sale yet.
            const seenPhone = new Map<string, string[]>();

            let valid = 0, rejected = 0, exception = 0, linked = 0, noted = 0;

            for (const s of shaped) {
              if (!s.result.ok) {
                rejected++;
                verdicts.push({
                  id: s.id,
                  status: "rejected",
                  rejection_reason: s.result.reason,
                  rejection_hint: s.result.hint ?? null,
                  exception_reason: null,
                  stove_serial_no: null,
                  normalized: null,
                  transaction_id: null,
                  duplicate_of_row: null,
                  shared_phone_with: null,
                });
                continue;
              }
              const row = s.result.row;
              const found = byStoveId.get(row.stoveSerialNo);
              const transactionId = transferBySerial.get(row.stoveSerialNo) ?? null;
              const duplicateOf = firstSeen.get(row.stoveSerialNo) ?? null;
              if (duplicateOf === null) {
                firstSeen.set(row.stoveSerialNo, s.rowNumber);
                // Counted once per serial, not once per row. A duplicate is
                // tied to the same transfer as the row it repeats, and saying
                // "2 matched" for one stove would overstate the reconciliation.
                if (transactionId) linked++;
              }

              /**
               * Everything already on this number: live sales first, then
               * earlier rows of this same file. Both matter - a sheet that
               * repeats a number is exactly as worth looking at as one that
               * collides with the register.
               */
              const tail = tailOf(row.phone);
              let sharedWith: string[] | null = null;
              if (tail.length === 10) {
                const already = [
                  ...(tails.get(tail) ?? []),
                  ...(seenPhone.get(tail) ?? []),
                ].filter((serial) => serial && serial !== row.stoveSerialNo);
                if (already.length > 0) sharedWith = [...new Set(already)];
                seenPhone.set(tail, [...(seenPhone.get(tail) ?? []), row.stoveSerialNo]);
              }

              /*
               * The columns the system filled in, checked against the stove ID.
               *
               * The sheet this module hands out arrives with five columns
               * already filled: the stove ID, the transfer reference, the
               * partner, the sales rep and the transfer date. Only the stove ID
               * was ever read back. The other four were decoration, so a sheet
               * whose rows had been sorted, or pasted a column at a time, or had
               * one stove ID overwritten, imported cleanly and put a buyer
               * against the wrong stove. Nothing in the file contradicts itself
               * loudly enough to notice by eye at four hundred rows.
               *
               * So each one is compared with what the stove ID resolves to.
               * Absent columns are not checked: somebody may be using their own
               * sheet, and demanding a column they never had would refuse a file
               * for lacking decoration.
               *
               * WHAT BLOCKS AND WHAT DOES NOT
               *
               * Partner and transfer reference block. Either disagreeing means
               * the row is about a different consignment from the one its stove
               * ID names, and there is no reading of that which is safe to
               * import.
               *
               * The sales rep is reported and does not block: a consignment can
               * legitimately be re-attributed, and refusing four hundred rows
               * over a name in a column nobody sells from would be the check
               * costing more than it catches.
               *
               * The transfer date is not compared at all. A spreadsheet rewrites
               * dates on open, so the comparison would fail on formatting rather
               * than on facts, which trains people to ignore it.
               */
              const sheetSays = (key: string) => {
                const v = field(s.raw as Record<string, unknown>, key);
                return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
              };
              const agrees = (a: string | null, b: string | null | undefined) =>
                a === null || b === null || b === undefined ||
                a.toLowerCase().replace(/\s+/g, " ") ===
                  String(b).toLowerCase().replace(/\s+/g, " ");

              const sheetPartner = sheetSays("partnerName");
              const sheetRef = sheetSays("transactionId");
              const sheetRep = sheetSays("salesRep");
              const stockRef = transferBySerial.get(row.stoveSerialNo.toUpperCase()) ?? null;
              const stockRep = repBySerial.get(row.stoveSerialNo.toUpperCase()) ?? null;

              /*
               * The partner check blocks only on a sheet this module wrote.
               *
               * On our own sheet the Partner column is filled BY US from the
               * stove ID, so a disagreement means the row moved and blocking is
               * right. On somebody else's sheet it is a human's shorthand for
               * the same partner, and blocking it is refusing correct data over
               * a naming convention.
               *
               * Measured on the real digitisation file before this existed:
               * 580 of 983 rows refused, 17 agreed. "Amina Sales Model Kajuru"
               * against "Kajuru". "Solar Sisters" against "SOLAR SISTER
               * IBADAN". Not one was an error.
               *
               * The transfer reference is the tell, because only our sheet
               * carries it. It is also the column that actually identifies a
               * consignment, so where it IS present it still blocks: that is a
               * value the file was given rather than one somebody typed.
               */
              const ourSheet = sheetRef !== null;

              let columnMismatch: string | null = null;
              let columnWarning: string | null = null;
              if (found && !agrees(sheetPartner, found.partner_name)) {
                const said =
                  `The Partner column says "${sheetPartner}" but stove ${row.stoveSerialNo} ` +
                  `belongs to "${found.partner_name ?? "no partner"}".`;
                if (ourSheet) {
                  columnMismatch = `${said} Either the stove ID or the partner on this row is wrong.`;
                } else {
                  columnWarning =
                    `${said} The stove ID decides, so this row is filed under ` +
                    `"${found.partner_name ?? "no partner"}".`;
                }
              }
              if (!columnMismatch && stockRef && !agrees(sheetRef, stockRef)) {
                columnMismatch =
                  `The Transaction ID column says "${sheetRef}" but stove ${row.stoveSerialNo} ` +
                  `came on ${stockRef}. Either the stove ID or the reference on this row is wrong.`;
              }

              const repWarning =
                !columnMismatch && !columnWarning && stockRep && !agrees(sheetRep, stockRep)
                  ? `The Sales Rep column says "${sheetRep}" and the consignment records ` +
                    `"${stockRep}". Imported as it stands.`
                  : null;

              let exceptionReason: string | null = columnMismatch;
              if (duplicateOf !== null) {
                exceptionReason =
                  `Stove serial "${row.stoveSerialNo}" already appears on row ${duplicateOf} of this file`;
              } else if (columnMismatch) {
                // Already set above. Named here so the order of causes reads in
                // one place rather than one of them being invisible.
                exceptionReason = columnMismatch;
              } else if (!found) {
                exceptionReason = `Stove serial "${row.stoveSerialNo}" is not in stock records`;
              } else if (orgId && found.organization_id !== orgId) {
                /*
                 * Only when the batch has a partner of its own.
                 *
                 * A batch pinned to one partner, which is manual entry, the
                 * bench, and any single-partner file, must still refuse a stove
                 * belonging to somebody else: the operator said whose sheet this
                 * was and a stray serial is a mistake worth stopping.
                 *
                 * A mixed batch has no partner to disagree with. Each row's
                 * partner IS whatever stock says, and every partner in the file
                 * was scope-checked at staging, so there is nothing left here to
                 * refuse. Leaving this check unconditional made every row of a
                 * mixed file an exception reading "belongs to a different
                 * partner", which is true of no row and confusing about all of
                 * them.
                 */
                exceptionReason = `Stove serial "${row.stoveSerialNo}" belongs to a different partner`;
              } else if (found.status === "sold") {
                exceptionReason = `Stove serial "${row.stoveSerialNo}" is already recorded as sold`;
              }

              if (exceptionReason) {
                exception++;
                verdicts.push({
                  id: s.id,
                  status: "exception",
                  rejection_reason: null,
                  rejection_hint: null,
                  exception_reason: exceptionReason,
                  stove_serial_no: row.stoveSerialNo,
                  normalized: JSON.stringify(row),
                  transaction_id: transactionId,
                  duplicate_of_row: duplicateOf,
                  shared_phone_with: sharedWith,
                });
              } else {
                valid++;
                // Carry the serial exactly as stock spells it, not as the
                // operator typed it or as this function upper-cased it for
                // matching. create-sale compares case-sensitively, so a row
                // that validated on `SA000000A0` would be refused at commit for
                // a stove recorded as `SA000000a0`.
                /*
                 * The partner this row resolved to, recorded under its own name.
                 *
                 * Deliberately NOT `organizationId`. That is a create-sale
                 * field name, and PASSTHROUGH_FIELDS exists precisely so a
                 * column called `organizationId` in somebody's spreadsheet
                 * cannot decide whose sale it is. These keys are written by the
                 * server from stock and are only ever compared against stock
                 * again at commit, so the file cannot reach them either way.
                 */
                /*
                 * Warnings travel with the row.
                 *
                 * They were computed and dropped, which is worse than never
                 * computing them: the code looked like it reported a sales-rep
                 * mismatch and a partner shorthand, and nothing ever did. A
                 * warning nobody can read is a comment, not a feature.
                 *
                 * On `normalized` rather than a new column, because the row
                 * already carries this object and a migration for a note the
                 * import writes and the panel reads would be a schema change
                 * for a sentence.
                 */
                const importWarnings = [columnWarning, repWarning].filter(Boolean);
                if (importWarnings.length) noted++;
                const canonical = {
                  ...row,
                  stoveSerialNo: found!.stove_id,
                  resolvedOrganizationId: found!.organization_id ?? null,
                  resolvedPartnerId: found!.partner_id ?? null,
                  resolvedPartnerName: found!.partner_name ?? null,
                  ...(importWarnings.length ? { importWarnings } : {}),
                };
                verdicts.push({
                  id: s.id,
                  status: "valid",
                  rejection_reason: null,
                  rejection_hint: null,
                  exception_reason: null,
                  stove_serial_no: found!.stove_id,
                  normalized: JSON.stringify(canonical),
                  transaction_id: transactionId,
                  duplicate_of_row: duplicateOf,
                  shared_phone_with: sharedWith,
                });
              }
            }

            /**
             * Sharing is mutual, so the flag is too.
             *
             * Walking the rows in order, the first stove on a number sees
             * nothing ahead of it and the later ones see it - which shows two
             * of three rows amber and reads as though the first is fine. A
             * person scanning the sheet has to see every row in the group,
             * from whichever one they happen to be looking at.
             */
            const group = new Map<string, Set<string>>();
            for (const v of verdicts) {
              if (!v.shared_phone_with || !v.stove_serial_no) continue;
              for (const other of [...v.shared_phone_with, v.stove_serial_no]) {
                if (!group.has(other)) group.set(other, new Set());
                for (const each of [...v.shared_phone_with, v.stove_serial_no]) {
                  if (each !== other) group.get(other)!.add(each);
                }
              }
            }
            for (const v of verdicts) {
              const mates = v.stove_serial_no ? group.get(v.stove_serial_no) : null;
              if (mates && mates.size > 0) v.shared_phone_with = [...mates].sort();
            }

            if (verdicts.length > 0) {
              /**
               * `normalized` arrives as a JSON *string* inside the payload and
               * is cast back to jsonb here rather than nested as an object,
               * because nesting it would make the outer document depend on the
               * shape of every row's contents - and one row carrying a key
               * that collides with a column name would silently reshape the
               * recordset.
               */
              await conn.queryObject({
                text: `update data_center.import_rows r
                          set status           = v.status,
                              rejection_reason = v.rejection_reason,
                              rejection_hint   = v.rejection_hint,
                              exception_reason = v.exception_reason,
                              stove_serial_no  = coalesce(v.stove_serial_no, r.stove_serial_no),
                              normalized       = v.normalized::jsonb,
                              transaction_id   = v.transaction_id,
                              duplicate_of_row = v.duplicate_of_row,
                              shared_phone_with = case
                                when v.shared_phone_with is null then null
                                else array(select jsonb_array_elements_text(v.shared_phone_with))
                              end
                         from jsonb_to_recordset($1::jsonb) as v(
                                id uuid, status text,
                                rejection_reason text, rejection_hint text,
                                exception_reason text, stove_serial_no text,
                                normalized text, transaction_id text,
                                duplicate_of_row int, shared_phone_with jsonb
                              )
                        where r.id = v.id`,
                args: [JSON.stringify(verdicts)],
              });
            }

            await conn.queryObject({
              text: `update data_center.import_batches
                     set state = 'validated', valid_rows = $2, rejected_rows = $3
                     where id = $1`,
              args: [batchId, valid, rejected + exception],
            });
            await conn.queryObject("commit");
            return json(
              { data: { valid, rejected, exception, linkedToTransfer: linked, noted } },
              200,
              cors,
            );
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * What a commit would change, written down and nothing touched.
       *
       * The stove list is the point: these are the serials that would move from
       * available to sold, which is the change people will notice in the sales
       * app's own inventory.
       */
      case "dry_run": {
        requireFeature("import.upload");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        return await withConnection(async (conn) => {
          const counts = await conn.queryObject<{ status: string; n: number }>({
            text: `select status, count(*)::int n from data_center.import_rows
                   where batch_id = $1 group by status`,
            args: [batchId],
          });
          const stoves = await conn.queryObject<{ stove_serial_no: string }>({
            text: `select stove_serial_no from data_center.import_rows
                   where batch_id = $1 and status = 'valid' order by row_number limit 500`,
            args: [batchId],
          });
          const summary = {
            byStatus: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
            stovesThatWouldSell: stoves.rows.map((s) => s.stove_serial_no),
            note: "Committing marks each of these stoves sold and creates a sale for it. Nothing has changed yet.",
          };
          await conn.queryObject({
            text: `update data_center.import_batches
                   set state = case when state = 'validated' then 'dry_run' else state end,
                       dry_run_at = now(), dry_run_summary = $2::jsonb
                   where id = $1`,
            args: [batchId, JSON.stringify(summary)],
          });
          return json({ data: summary }, 200, cors);
        });
      }

      /**
       * Commit one slice.
       *
       * Each row is claimed, then created through create-sale, then recorded.
       * The claim is taken first and separately: if create-sale fails, the
       * claim is released rather than leaving a stove nobody can import.
       */
      case "commit": {
        requireFeature("import.commit");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        const sliceSize = Number(
          await withReadConnection((c) => readConfig(c, "import.slice_size", 25)),
        ) || 25;

        const slice = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{
            id: string;
            stove_serial_no: string;
            normalized: NormalizedRow;
            // What the row carried beyond the spine. Without these two the
            // passthrough has nothing to read and every extra field the bench
            // collects is dropped between the row and the sale.
            draft_values: Record<string, unknown> | null;
            raw: Record<string, unknown> | null;
            stock_org_id: string | null;
            stock_partner_name: string | null;
          }>({
            /*
             * The partner is resolved here, from stock, per row.
             *
             * A lateral with limit 1 rather than a plain join: one stove ID
             * still exists as two stock rows at two different partners, and a
             * join would return that row twice, which in this loop means
             * committing it twice.
             */
            text: `select r.id, r.stove_serial_no, r.normalized, r.draft_values, r.raw,
                          k.organization_id::text as stock_org_id,
                          k.partner_name as stock_partner_name
                     from data_center.import_rows r
                     left join lateral (
                       select sb.organization_id, o.partner_name
                         from public.stove_ids_base sb
                         left join public.organizations o on o.id = sb.organization_id
                        where upper(sb.stove_id) = upper(r.stove_serial_no)
                        order by sb.organization_id
                        limit 1
                     ) k on true
                    where r.batch_id = $1 and r.status = 'valid'
                    order by r.row_number limit $2`,
            args: [batchId, sliceSize],
          });
          return r.rows;
        });

        if (slice.length === 0) {
          await withConnection(async (conn) => {
            await conn.queryObject({
              text: `update data_center.import_batches
                     set state = 'committed', committed_at = now(), committed_by = $2
                     where id = $1 and state <> 'committed'`,
              args: [batchId, userId],
            });
          });
          return json({ data: { done: true, committed: 0 } }, 200, cors);
        }

        // create-sale requires partnerName as well as organizationId, so both
        // come from one lookup rather than the name being guessed from the file.
        const org = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{ organization_id: string; partner_name: string }>({
            text: `select b.organization_id, o.partner_name
                   from data_center.import_batches b
                   left join public.organizations o on o.id = b.organization_id
                   where b.id = $1`,
            args: [batchId],
          });
          return r.rows[0] ?? null;
        });
        /*
         * A batch with no partner is normal now: it means the file covered
         * several, and each row carries its own. What is not normal is a row
         * that resolves to neither, and that is refused per row below rather
         * than failing the whole batch.
         */
        const batchOrgId = org?.organization_id ?? null;

        let committed = 0;
        const failures: { rowId: string; reason: string }[] = [];

        /** Refuse one row without touching the rest of the batch. */
        const refuseRow = async (rowId: string, why: string) => {
          await withConnection(async (conn) => {
            await conn.queryObject({
              text: `update data_center.import_rows
                     set status = 'exception', exception_reason = $2 where id = $1`,
              args: [rowId, why],
            });
          });
          failures.push({ rowId, reason: why });
        };

        for (const row of slice) {
          /*
           * Whose sale this is, decided by stock rather than by the file.
           *
           * The batch's partner is only a fallback now, for the bench and for
           * single-partner files. What decides is the stove ID, because it is
           * the one column in a spreadsheet that can be checked against
           * something the writer of the spreadsheet does not control.
           *
           * This matters more than it sounds. Several partner names cover more
           * than one organization: four are called LAPO, four Solar Sister, and
           * two Solar Sister rows are both "Main Branch" in different states.
           * A sheet that named its partner would land those rows under
           * whichever row the name happened to match first. The stove ID lands
           * them under the branch that actually holds the stove.
           */
          const rowOrgId = row.stock_org_id ?? batchOrgId;
          const rowPartnerName = row.stock_partner_name ?? org?.partner_name ?? null;

          if (!rowOrgId) {
            await refuseRow(
              row.id,
              `Stove ${row.stove_serial_no} is not in stock against any partner, so there is ` +
                "nobody to record this sale for.",
            );
            continue;
          }

          /*
           * The answer the operator was shown, checked against the answer now.
           *
           * Staging previewed a partner per row and somebody approved it. If
           * the stove has been transferred since, committing under the partner
           * they were shown would be wrong and committing under the new one
           * silently would be worse. Refusing the row says which, and the rest
           * of the batch still lands.
           */
          const stagedOrgId =
            (row.normalized as unknown as Record<string, unknown>).resolvedOrganizationId ?? null;
          if (
            typeof stagedOrgId === "string" &&
            row.stock_org_id &&
            stagedOrgId !== row.stock_org_id
          ) {
            await refuseRow(
              row.id,
              `Stove ${row.stove_serial_no} has moved to a different partner since this file was ` +
                "checked. Re-validate the batch so the change is on screen before it is committed.",
            );
            continue;
          }

          // Claim first. The primary key is the lock: a second batch asking for
          // the same serial gets a conflict here rather than a duplicate sale.
          const claimed = await withConnection(async (conn) => {
            const r = await conn.queryObject({
              text: `insert into data_center.import_claims (stove_serial_no, batch_id, row_id, claimed_by)
                     values ($1, $2, $3, $4)
                     on conflict (stove_serial_no) do nothing
                     returning stove_serial_no`,
              args: [row.stove_serial_no, batchId, row.id, userId],
            });
            return r.rows.length > 0;
          });

          if (!claimed) {
            failures.push({ rowId: row.id, reason: "Another import is already committing this stove" });
            await withConnection(async (conn) => {
              await conn.queryObject({
                text: `update data_center.import_rows
                       set status = 'exception', exception_reason = $2 where id = $1`,
                args: [row.id, "Another import is already committing this stove"],
              });
            });
            continue;
          }

          // Through create-sale, never around it. The caller's own token is
          // forwarded so the sale is attributed to them and org scoping is
          // enforced by the same code the Sell Stove form goes through.
          // create-sale's own field names, not this module's. Anything it does
          // not name is omitted rather than guessed: a receipt does not carry a
          // payment model, a drawn signature or an uploaded photo, and
          // create-sale requires none of them.
          const n = row.normalized;
          const extras = (row.draft_values ?? row.raw ?? null) as
            | Record<string, unknown>
            | null;
          const payload = {
            stoveSerialNo: n.stoveSerialNo,
            salesDate: n.salesDate,
            endUserName: n.endUserName,
            aka: n.aka,
            phone: n.phone,
            otherPhone: n.otherPhone,
            contactPerson: n.contactPerson,
            contactPhone: n.contactPhone,
            amount: n.amount,
            amountReceived: n.amountReceived,
            stateBackup: n.state,
            lgaBackup: n.lga,
            // The bench already holds a full addressData with coordinates when
            // the address came off a map; a spreadsheet row has only the three
            // strings. Keep the richer one where it exists.
            addressData: (extras?.addressData &&
                typeof extras.addressData === "object" &&
                (extras.addressData as Record<string, unknown>).fullAddress)
              ? extras.addressData
              : { fullAddress: n.fullAddress, state: n.state, city: n.lga },
            organizationId: rowOrgId,
            partnerName: rowPartnerName,
            // Everything the row carried beyond the spine. A bench row brings
            // the signature, the photographs and the rest of the form; a
            // spreadsheet row brings none of it and the object is empty.
            ...passthroughFrom(extras),
            termsAccepted: termsFrom(extras),
          };

          let saleId: string | null = null;
          let sharesPhoneWith: { sale_id: string }[] = [];
          let reason = "";
          // Three attempts, but only for a transaction ID collision. Any other
          // refusal is a fact about the row and retrying would just produce the
          // same answer more slowly.
          for (let attempt = 0; attempt < 3 && !saleId; attempt++) {
            try {
              const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/create-sale`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                  apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
                },
                /**
                 * The digitalisation path means it about a shared number.
                 *
                 * create-sale refuses a phone already on a live sale, which is
                 * right in front of a customer and wrong over a stack of
                 * receipts where a man bought stoves for two wives on one
                 * number. The flag does not skip the check; it turns the
                 * refusal into a report, and the answer comes back naming the
                 * sales already on the number so the sharing can be recorded
                 * rather than discovered later.
                 *
                 * Only this path sends it. The Sell Stove form and the mobile
                 * app never do, so nothing about them changes.
                 */
                body: JSON.stringify({
                  ...payload,
                  transactionId: newTransactionId(),
                  allowSharedPhone: true,
                }),
              });
              const out = await res.json().catch(() => ({}));
              // create-sale answers { success, sale_id, data: { id } }.
              const created = out?.data?.id ?? out?.sale_id ?? out?.saleId ?? null;
              if (res.ok && created) {
                saleId = created;
                sharesPhoneWith = Array.isArray(out?.shares_phone_with)
                  ? (out.shares_phone_with as { sale_id: string }[])
                  : [];
                break;
              }
              reason = out?.message ?? out?.error ?? `create-sale refused this row (${res.status})`;
              if (!/transaction id/i.test(reason)) break;
            } catch (err) {
              reason = `create-sale could not be reached: ${err instanceof Error ? err.message : "unknown"}`;
              break;
            }
          }

          await withConnection(async (conn) => {
            await conn.queryObject("begin");
            try {
              await conn.queryObject({
                text: "select set_config('data_center.actor', $1, true)",
                args: [userId],
              });
              if (saleId) {
                await conn.queryObject({
                  // confirmed_by is recorded apart from resolved_by on purpose.
                  // "Who typed this" and "who let it through" are different
                  // answers and are often different people, which is the whole
                  // of the control: a row reaches public.sales because somebody
                  // released it, not because somebody typed it.
                  text: `update data_center.import_rows
                         set status = 'committed', sale_id = $2,
                             resolved_by = $3, resolved_at = now(),
                             confirmed_by = $3, confirmed_at = now()
                         where id = $1`,
                  args: [row.id, saleId, userId],
                });
                /*
                 * Release the claim now the sale exists.
                 *
                 * The claim is a lock held WHILE a batch commits, which is
                 * what its own table comment says, and the lock's job is done
                 * the moment public.sales has the row. From here the real
                 * guard is stock: create-sale refuses a stove already marked
                 * sold, so nothing depends on this row surviving.
                 *
                 * It used to be updated with the sale id and left behind, and
                 * that quietly made an import once-ever. Delete the sale
                 * through the sales app later and the stove returns to
                 * available, but the claim stayed - so re-importing that
                 * receipt was refused with "Another import is already
                 * committing this stove", which by then was neither true nor
                 * something anybody could act on.
                 */
                await conn.queryObject({
                  text: "delete from data_center.import_claims where row_id = $1",
                  args: [row.id],
                });

                /**
                 * A number holding more than one stove goes on the register.
                 *
                 * Both ends of it: the sale just created, and every sale that
                 * already held the number - because a person opening either
                 * record should see the other, and a row written for only one
                 * side makes the second stove invisible from the first.
                 *
                 * In the same transaction as the commit, so a number can never
                 * be shared without the register saying so.
                 */
                if (sharesPhoneWith.length > 0) {
                  await conn.queryObject({
                    text: `insert into data_center.shared_phones
                             (phone_tail, sale_id, stove_id, phone_as_written,
                              source, created_by, updated_by)
                           select right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10),
                                  s.id, s.stove_serial_no, s.phone,
                                  'digitalisation', $2, $2
                             from public.sales s
                            where s.id = any($1::uuid[])
                              and length(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')) >= 10
                           on conflict (phone_tail, sale_id) do update
                              set stove_id = excluded.stove_id,
                                  phone_as_written = excluded.phone_as_written,
                                  updated_at = now(), updated_by = excluded.updated_by`,
                    args: [
                      [saleId, ...sharesPhoneWith.map((r) => r.sale_id)],
                      userId,
                    ],
                  });
                }
              } else {
                // Release the claim: the sale did not happen, so nothing should
                // be holding the stove.
                await conn.queryObject({
                  text: "delete from data_center.import_claims where row_id = $1",
                  args: [row.id],
                });
                await conn.queryObject({
                  text: `update data_center.import_rows
                         set status = 'exception', exception_reason = $2 where id = $1`,
                  args: [row.id, reason],
                });
              }
              await conn.queryObject("commit");
            } catch (err) {
              await conn.queryObject("rollback");
              throw err;
            }
          });

          if (saleId) committed++;
          else failures.push({ rowId: row.id, reason });
        }

        const remaining = await withConnection(async (conn) => {
          const r = await conn.queryObject<{ n: number }>({
            text: `select count(*)::int n from data_center.import_rows
                   where batch_id = $1 and status = 'valid'`,
            args: [batchId],
          });
          const left = r.rows[0]?.n ?? 0;
          await conn.queryObject({
            text: `update data_center.import_batches
                   set committed_rows = (select count(*) from data_center.import_rows
                                          where batch_id = $1 and status = 'committed'),
                       state = case when $2 = 0 then 'committed' else 'validated' end,
                       committed_at = case when $2 = 0 then now() else committed_at end,
                       committed_by = case when $2 = 0 then $3 else committed_by end,
                       last_error = $4
                   where id = $1`,
            args: [batchId, left, userId, failures.length ? failures[0].reason : null],
          });
          return left;
        });

        return json(
          { data: { committed, failed: failures.length, remaining, done: remaining === 0, failures } },
          200,
          cors,
        );
      }

      /**
       * Put a committed batch back.
       *
       * Each sale is removed through delete-sale, which releases the stove to
       * available as part of its own job. Deleting rows here instead would
       * leave stock believing stoves were still sold.
       */
      case "rollback": {
        requireFeature("import.commit");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        /*
         * Refuse if the call centre has already worked these records.
         *
         * Rollback deletes each sale through `delete-sale`, which is a hard
         * delete on public.sales - and six data_center tables cascade off
         * that: call_records, call_attempts, call_drafts, assignment_items,
         * shared_phones and serial_rematches. So rolling back a batch after
         * agents have started calling does not just undo the import, it
         * destroys the calls, and there is no way back.
         *
         * IMPORT.md said rollback "cannot undo anything that happened to
         * those sales in between", which reads as a limitation and is
         * actually a deletion. Nothing checked, and rollback is exactly the
         * button somebody reaches for when an import went in wrong.
         *
         * Refused rather than warned, and the count is named, because the
         * person pressing this cannot see the call records from here. If the
         * batch genuinely has to go, the calls come off first, deliberately.
         */
        const attached = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{
            with_record: number;
            attempts: number;
            with_draft: number;
          }>({
            // call_records and call_drafts are both keyed by sale_id as their
            // primary key, so neither join can fan a row out.
            text: `select
                     count(*) filter (where cr.sale_id is not null)::int as with_record,
                     coalesce(sum(cr.attempt_count), 0)::int             as attempts,
                     count(*) filter (where cd.sale_id is not null)::int as with_draft
                   from data_center.import_rows r
                   left join data_center.call_records cr on cr.sale_id = r.sale_id
                   left join data_center.call_drafts  cd on cd.sale_id = r.sale_id
                   where r.batch_id = $1
                     and r.status = 'committed'
                     and r.sale_id is not null`,
            args: [batchId],
          });
          return r.rows[0] ?? { with_record: 0, attempts: 0, with_draft: 0 };
        });

        const touched = Number(attached.with_record) + Number(attached.with_draft);
        if (touched > 0) {
          const say = (n: number, one: string, many: string) =>
            `${n} ${n === 1 ? one : many}`;
          const parts = [
            say(Number(attached.with_record), "sale carries a call record", "sales carry call records"),
          ];
          if (Number(attached.attempts) > 0) {
            parts.push(say(Number(attached.attempts), "logged call attempt", "logged call attempts"));
          }
          if (Number(attached.with_draft) > 0) {
            parts.push(say(Number(attached.with_draft), "has an unsaved draft", "have unsaved drafts"));
          }
          return json(
            {
              error:
                `This batch cannot be rolled back: ${parts.join(", ")}. ` +
                "Rolling back deletes the sales, and the call centre's work on them " +
                "goes with it and cannot be recovered. Clear those records first if " +
                "the batch really has to be reversed.",
              code: "call_work_attached",
              details: {
                withRecord: Number(attached.with_record),
                attempts: Number(attached.attempts),
                withDraft: Number(attached.with_draft),
              },
            },
            409,
            cors,
          );
        }

        const sliceSize = Number(
          await withReadConnection((c) => readConfig(c, "import.slice_size", 25)),
        ) || 25;

        const slice = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{ id: string; sale_id: string }>({
            text: `select id, sale_id from data_center.import_rows
                   where batch_id = $1 and status = 'committed' and sale_id is not null
                   order by row_number limit $2`,
            args: [batchId, sliceSize],
          });
          return r.rows;
        });

        let reversed = 0;
        for (const row of slice) {
          let ok = false;
          try {
            const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/delete-sale`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
                apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
              },
              body: JSON.stringify({ saleId: row.sale_id }),
            });
            ok = res.ok;
          } catch {
            ok = false;
          }
          if (!ok) continue;

          await withConnection(async (conn) => {
            await conn.queryObject("begin");
            try {
              await conn.queryObject({
                text: "select set_config('data_center.actor', $1, true)",
                args: [userId],
              });
              await conn.queryObject({
                text: `update data_center.import_rows
                       set status = 'valid', sale_id = null where id = $1`,
                args: [row.id],
              });
              await conn.queryObject({
                text: "delete from data_center.import_claims where row_id = $1",
                args: [row.id],
              });
              await conn.queryObject("commit");
            } catch (err) {
              await conn.queryObject("rollback");
              throw err;
            }
          });
          reversed++;
        }

        const remaining = await withConnection(async (conn) => {
          const r = await conn.queryObject<{ n: number }>({
            text: `select count(*)::int n from data_center.import_rows
                   where batch_id = $1 and status = 'committed'`,
            args: [batchId],
          });
          const left = r.rows[0]?.n ?? 0;
          if (left === 0) {
            await conn.queryObject({
              text: `update data_center.import_batches
                     set state = 'rolled_back', committed_rows = 0 where id = $1`,
              args: [batchId],
            });
            await conn.queryObject({
              text: "select data_center.release_import_claims($1)",
              args: [batchId],
            });
          }
          return left;
        });

        return json({ data: { reversed, remaining, done: remaining === 0 } }, 200, cors);
      }

      /** Fix the serial on an exception row and put it back in the queue. */
      case "resolve_exception": {
        requireFeature("import.exceptions");
        const rowId = String(body.rowId ?? "");
        const serial = String(body.correctedSerial ?? "").trim().toUpperCase();
        if (!rowId) throw new BadRequest("rowId is required");
        if (!serial) throw new BadRequest("A corrected stove serial is required");

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const r = await conn.queryObject<{ batch_id: string; normalized: NormalizedRow }>({
              text: "select batch_id, normalized from data_center.import_rows where id = $1 for update",
              args: [rowId],
            });
            if (r.rows.length === 0) throw new BadRequest("No such row");

            const orgRow = await conn.queryObject<{ organization_id: string }>({
              text: "select organization_id from data_center.import_batches where id = $1",
              args: [r.rows[0].batch_id],
            });
            const stock = await conn.queryObject<{ stove_id: string; status: string; organization_id: string }>({
              text: `select stove_id, status, organization_id from public.stove_ids_base
                     where upper(stove_id) = $1`,
              args: [serial],
            });

            // The same checks validate applies. A correction that does not
            // resolve the problem stays an exception with the new reason,
            // rather than becoming valid and failing later at commit.
            let reason: string | null = null;
            if (stock.rows.length === 0) reason = `Stove serial "${serial}" is not in stock records`;
            else if (stock.rows[0].organization_id !== orgRow.rows[0]?.organization_id) {
              reason = `Stove serial "${serial}" belongs to a different partner`;
            } else if (stock.rows[0].status === "sold") {
              reason = `Stove serial "${serial}" is already recorded as sold`;
            }

            // Same rule as validate: downstream carries stock's own spelling.
            const canonicalSerial = stock.rows[0]?.stove_id ?? serial;
            const normalized = { ...(r.rows[0].normalized ?? {}), stoveSerialNo: canonicalSerial };
            await conn.queryObject({
              text: `update data_center.import_rows
                     set corrected_serial = $2,
                         stove_serial_no = $2,
                         normalized = $3::jsonb,
                         status = case when $4::text is null then 'valid' else 'exception' end,
                         exception_reason = $4,
                         resolved_by = $5, resolved_at = now()
                     where id = $1`,
              args: [rowId, canonicalSerial, JSON.stringify(normalized), reason, userId],
            });

            // Recount rather than adjust. Resolving an exception moves a row
            // between buckets, and a counter nudged by hand drifts the moment
            // anything else touches the batch.
            await conn.queryObject({
              text: `update data_center.import_batches b
                     set valid_rows    = (select count(*) from data_center.import_rows r
                                           where r.batch_id = b.id and r.status = 'valid'),
                         rejected_rows = (select count(*) from data_center.import_rows r
                                           where r.batch_id = b.id and r.status in ('rejected','exception'))
                     where b.id = $1`,
              args: [r.rows[0].batch_id],
            });
            await conn.queryObject("commit");
            return json({ data: { rowId, resolved: reason === null, reason } }, 200, cors);
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /* =====================================================================
       * The call-centre sheet.
       *
       * Same batch machinery as a receipt import, a different subject. These
       * rows MATCH sales rather than making them, so they get their own
       * actions instead of branching the receipt path: entangling the two
       * would put the thing that already works and is tested at risk for a
       * feature that shares nothing but the table it stages into.
       *
       * The work itself is in call-import.ts. What lives here is the gate,
       * the slice size, and the door out to data-center-write.
       *
       * The gate is `call_import.use`, granted to nobody by default. It used to
       * be `import.upload`, which every person digitalising receipts holds, so
       * the tab appeared for the whole bench. This is the authority: the tab in
       * ImportPage.jsx checks the same key, but a hidden button is not a
       * permission.
       * ===================================================================== */

      /** The columns the sheet carries, registry questions included. */
      case "call_sheet": {
        requireFeature("call_import.use");
        return await withReadConnection(async (conn) => {
          const spec = await callSheetSpec(conn);
          return json({ data: spec }, 200, cors);
        });
      }

      case "call_stage": {
        requireFeature("call_import.use");
        const incoming = body.rows as Record<string, unknown>[] | undefined;
        if (!Array.isArray(incoming) || incoming.length === 0) {
          throw new BadRequest("No rows to import");
        }
        const maxRows = Number(
          await withReadConnection((c) => readConfig(c, "import.max_rows", 20000)),
        ) || 20000;
        if (incoming.length > maxRows) {
          throw new BadRequest(
            `That sheet has ${incoming.length} rows and the limit is ${maxRows}. Split it.`,
          );
        }

        const batchId = await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const b = await conn.queryObject<{ id: string }>({
              text: `insert into data_center.import_batches
                       (source, filename, uploaded_by, state, total_rows)
                     values ($1, $2, $3, 'staged', $4) returning id::text`,
              args: [
                CALL_SOURCE,
                String(body.filename ?? "call-centre sheet"),
                userId,
                incoming.length,
              ],
            });
            const id = b.rows[0].id;
            /*
             * organization_id is left null, deliberately. A receipt batch is
             * one partner's paperwork; a call-centre week is whoever the
             * agents happened to reach, and forcing a partner onto it would
             * either be a lie or split a real day's work into twelve batches.
             * Scope still holds at the row: every row resolves to a sale, and
             * a sale carries its own organization.
             */
            for (let i = 0; i < incoming.length; i++) {
              await conn.queryObject({
                text: `insert into data_center.import_rows (batch_id, row_number, raw, status)
                       values ($1, $2, $3::jsonb, 'pending')`,
                args: [id, i + 1, JSON.stringify(incoming[i])],
              });
            }
            await conn.queryObject("commit");
            return id;
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });

        return json({ data: { batchId, staged: incoming.length } }, 200, cors);
      }

      case "call_validate": {
        requireFeature("call_import.use");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");
        return await withConnection(async (conn) => {
          await conn.queryObject({
            text: "select set_config('data_center.actor', $1, true)",
            args: [userId],
          });
          const summary = await validateCallRows(conn, batchId);
          return json({ data: summary }, 200, cors);
        });
      }

      case "call_commit": {
        // Both. Seeing the sheet and landing it are separate privileges, the
        // same split the receipt import makes between upload and commit.
        requireFeature("call_import.use");
        requireFeature("import.commit");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");
        const sliceSize = Number(
          await withReadConnection((c) => readConfig(c, "import.slice_size", 25)),
        ) || 25;

        /*
         * Out through data-center-write, not straight into the table.
         *
         * Exactly the rule the receipt import follows with create-sale, on
         * this side of the module: field visibility, the answers-versus-column
         * routing in splitPayload, the writable-column allowlist and the audit
         * trigger all stay in one place. The caller's own bearer token goes
         * with it, so a person cannot import past their own permissions.
         */
        const post = async (action: string, payload: Record<string, unknown>) => {
          try {
            const res = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/data-center-write`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                  apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
                },
                body: JSON.stringify({ action, ...payload }),
              },
            );
            if (res.ok) return { ok: true, detail: "" };
            const b = await res.json().catch(() => null);
            return {
              ok: false,
              detail: String(
                (b as { error?: string } | null)?.error ?? `write refused (${res.status})`,
              ),
            };
          } catch (err) {
            return {
              ok: false,
              detail: err instanceof Error ? err.message : "write failed",
            };
          }
        };

        return await withConnection(async (conn) => {
          await conn.queryObject({
            text: "select set_config('data_center.actor', $1, true)",
            args: [userId],
          });
          const out = await commitCallRows(conn, batchId, userId, sliceSize, post);
          return json({ data: out }, 200, cors);
        });
      }

      case "call_rollback": {
        requireFeature("call_import.use");
        requireFeature("import.commit");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");
        return await withConnection(async (conn) => {
          const out = await rollbackCallRows(conn, batchId, userId);
          return json({ data: out }, 200, cors);
        });
      }

      /**
       * Which partners this caller may import for.
       *
       * Scoped, not the whole list: create-sale will refuse an org the caller
       * is not assigned to anyway, and offering one that will be refused is a
       * worse experience than not offering it.
       */
      case "partners": {
        requireFeature("import.upload");
        return await withReadConnection(async (conn) => {
          if (superAdmin) {
            const r = await conn.queryObject({
              text: `select id, partner_name from public.organizations
                     order by partner_name limit 500`,
            });
            return json({ data: r.rows }, 200, cors);
          }
          // Everyone else sees their own organization, plus anything assigned
          // to them as an ACSL agent.
          const r = await conn.queryObject({
            text: `select o.id, o.partner_name from public.organizations o
                   where o.id = $2
                      or o.id in (select organization_id
                                    from public.acsl_agent_org_scope(array[$1::uuid]))
                   order by o.partner_name limit 500`,
            args: [userId, profile.organization_id ?? null],
          });
          return json({ data: r.rows }, 200, cors);
        });
      }

      /**
       * A stove, opened for typing.
       *
       * Returns whatever has been typed so far and who last touched it, so two
       * people do not work the same receipt without knowing. There is no lock:
       * a lock on a row somebody may walk away from needs a timeout, and a
       * timeout is a second way to lose work. Saying who is on it is enough
       * for a room of four people, which is the room this is for.
       */
      case "workbench_open": {
        requireFeature("digitisation.work");
        const stoveId = String(body.stoveId ?? "").trim().toUpperCase();
        if (!stoveId) throw new BadRequest("Which stove?");

        return await withReadConnection(async (conn) => {
          const stock = await conn.queryObject<{
            stove_id: string; organization_id: string | null; sales_reference: string | null;
            status: string | null; sale_id: string | null; partner_name: string | null;
          }>({
            text: `select sb.stove_id, sb.organization_id::text, sb.sales_reference,
                          sb.status, sb.sale_id::text, o.partner_name
                     from public.stove_ids_base sb
                     left join public.organizations o on o.id = sb.organization_id
                    where sb.stove_id = $1`,
            args: [stoveId],
          });
          const stove = stock.rows[0];
          if (!stove) {
            throw new BadRequest(
              `No stove with the ID "${stoveId}" is in stock. Check it against the transfer ` +
                "sheet: a digit dropped or an O typed for a zero looks exactly like this.",
            );
          }

          const existing = await conn.queryObject({
            text: `select r.id::text, r.status, r.draft_values, r.normalized,
                          r.rejection_reason, r.rejection_hint,
                          r.confirmed_at, r.sale_id::text,
                          r.last_edited_at, p.full_name as last_edited_by_name,
                          b.id::text as batch_id, b.uploaded_by::text as owner_id
                     from data_center.import_rows r
                     join data_center.import_batches b on b.id = r.batch_id
                     left join public.profiles p on p.id = r.last_edited_by
                    where r.stove_serial_no = $1
                      and b.state <> 'rolled_back'
                    order by r.last_edited_at desc nulls last
                    limit 1`,
            args: [stoveId],
          });

          return json(
            {
              data: {
                stove: {
                  stoveId: stove.stove_id,
                  organizationId: stove.organization_id,
                  partnerName: stove.partner_name,
                  transactionId: stove.sales_reference,
                  stockStatus: stove.status,
                  alreadySold: Boolean(stove.sale_id),
                },
                work: existing.rows[0] ?? null,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * Save what has been typed, finished or not.
       *
       * `complete` is the typist saying they are done, not the server deciding
       * it. A draft is never judged: validating a half-typed record and
       * rejecting it for fields nobody has reached yet is the fastest way to
       * teach somebody to stop saving their work.
       *
       * Every typist gets one open workbench batch per partner, reused. A batch
       * per record would make the confirmation queue a list of one-row batches
       * and the whole point is to be able to release a morning's work together.
       */
      case "workbench_save": {
        requireFeature("digitisation.work");
        const stoveId = String(body.stoveId ?? "").trim().toUpperCase();
        const values = (body.values ?? {}) as Record<string, unknown>;
        const complete = body.complete === true;
        if (!stoveId) throw new BadRequest("Which stove?");

        const record = fromSheetValues(autoMapRow(fromSaleForm({ ...values, stoveSerialNo: stoveId })));

        // Finishing means it has to hold together. Half-typed does not.
        //
        // Priced by the same rule as a file and a typed record, or the bench
        // would refuse a receipt the other two accept.
        const benchPrice = complete
          ? await withReadConnection((c) => modelPriceFor(c, record))
          : null;
        const shape = complete ? normalizeRow(record, { amount: benchPrice }) : null;
        const finished = shape?.ok ? shape.row : null;
        if (complete) {
          if (shape && !shape.ok) {
            return json(
              {
                error: shape.reason,
                code: "incomplete",
                data: {
                  hint: shape.hint ??
                    "Fill that in and save again, or Save draft to come back to it.",
                },
              },
              400,
              cors,
            );
          }
        }

        return await withConnection(async (conn) => {
          const stock = await conn.queryObject<{ organization_id: string | null }>({
            text: "select organization_id::text from public.stove_ids_base where stove_id = $1",
            args: [stoveId],
          });
          const organizationId = stock.rows[0]?.organization_id;
          if (!organizationId) {
            throw new BadRequest(`No stove with the ID "${stoveId}" is in stock.`);
          }
          await requireOrganization(organizationId);

          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });

            /*
             * One open bench batch per typist per partner, whatever state it
             * is in.
             *
             * This asked for `state = 'staged'`, which meant the moment a
             * typist's batch was validated or dry-run, the next receipt they
             * typed started a fresh one. A day of work fragmented into a row
             * per session in the confirmation queue, which is the opposite of
             * the aggregation the bench is built around - and production
             * already held the empty `staged` batch that proves it, sitting
             * beside the `dry_run` batch holding that typist's actual row.
             *
             * Committed and rolled-back batches are excluded because they are
             * finished: adding a row to either would reopen something the
             * sales app has already been told about.
             */
            const open = await conn.queryObject<{ id: string }>({
              text: `select id from data_center.import_batches
                      where source = 'workbench' and uploaded_by = $1
                        and organization_id = $2
                        and state not in ('committed', 'rolled_back')
                      order by uploaded_at desc limit 1`,
              args: [userId, organizationId],
            });
            let batchId = open.rows[0]?.id;
            if (!batchId) {
              const made = await conn.queryObject<{ id: string }>({
                text: `insert into data_center.import_batches
                         (source, filename, uploaded_by, organization_id, total_rows,
                          state, content_hash, source_note)
                       values ('workbench', null, $1, $2, 0, 'staged', $3,
                               'Typed one stove at a time in the workbench')
                       returning id`,
                // The hash is built here rather than in SQL: using $1 as both a
                // uuid column and a string to concatenate left Postgres unable
                // to decide what type the parameter was.
                args: [userId, organizationId, `workbench:${userId}:${organizationId}`],
              });
              batchId = made.rows[0].id;
            }

            const existing = await conn.queryObject<{ id: string; confirmed_at: string | null }>({
              text: `select r.id::text, r.confirmed_at
                       from data_center.import_rows r
                       join data_center.import_batches b on b.id = r.batch_id
                      where r.stove_serial_no = $1 and b.source = 'workbench'
                        and b.state <> 'rolled_back'
                      limit 1`,
              args: [stoveId],
            });

            if (existing.rows[0]?.confirmed_at) {
              await conn.queryObject("rollback");
              return json(
                {
                  error:
                    `Stove ${stoveId} has already been confirmed and is in the sales app. ` +
                    "Change it there rather than here, so there is one version of it.",
                  code: "already_confirmed",
                },
                409,
                cors,
              );
            }

            const status = complete ? "valid" : "draft";
            // What the row ends up with, which is not the same as what was
            // asked for: the downgrade guard below can refuse a draft save.
            let stored = status;
            if (existing.rows[0]) {
              const updated = await conn.queryObject<{ status: string }>({
                /*
                 * A draft save keeps the typing and leaves the verdict alone.
                 *
                 * It used to overwrite both, and the bench's own autosave then
                 * undid every finish: a receipt saved as finished was written
                 * back to `draft` with its finished shape nulled seconds
                 * later, so it read as "still being typed" and could not be
                 * confirmed. Production carried two such rows, both with
                 * `normalized` NULL, which is what that collision looks like
                 * afterwards.
                 *
                 * The bench has been fixed not to send that save. This is the
                 * invariant underneath it, because the bench is not the only
                 * caller and a rule enforced only in a component is a rule
                 * that holds until the next component.
                 *
                 * Finishing still downgrades nothing: `complete` sets status
                 * and shape outright. Only the incomplete path defers, and
                 * only to a row that is already valid - a rejected or
                 * excepted row still moves back to draft when it is reworked.
                 */
                text: `update data_center.import_rows
                          set draft_values = $2::jsonb,
                              status = case
                                         when $3 = 'valid' then 'valid'
                                         when status = 'valid' then 'valid'
                                         else $3
                                       end,
                              normalized = case
                                             when $3 = 'valid' then $4::jsonb
                                             when status = 'valid' then normalized
                                             else null
                                           end,
                              last_edited_by = $5, last_edited_at = now(),
                              rejection_reason = null, rejection_hint = null
                        where id = $1
                    returning status`,
                args: [
                  existing.rows[0].id, JSON.stringify(values), status,
                  finished ? JSON.stringify(finished) : null,
                  userId,
                ],
              });
              stored = String(updated.rows[0]?.status ?? status);
            } else {
              const next = await conn.queryObject<{ n: number }>({
                text: `select coalesce(max(row_number), 0) + 1 as n
                         from data_center.import_rows where batch_id = $1`,
                args: [batchId],
              });
              const inserted = await conn.queryObject<{ status: string }>({
                text: `insert into data_center.import_rows
                         (batch_id, row_number, raw, status, stove_serial_no,
                          draft_values, normalized, last_edited_by, last_edited_at)
                       values ($1, $2, $3::jsonb, $4, $5, $3::jsonb,
                               case when $4 = 'valid' then $6::jsonb else null end,
                               $7, now())
                       returning status`,
                args: [
                  batchId, next.rows[0].n, JSON.stringify(values), status, stoveId,
                  finished ? JSON.stringify(finished) : null,
                  userId,
                ],
              });
              stored = String(inserted.rows[0]?.status ?? status);
              await conn.queryObject({
                text: `update data_center.import_batches
                          set total_rows = (select count(*) from data_center.import_rows
                                             where batch_id = $1)
                        where id = $1`,
                args: [batchId],
              });
            }

            await conn.queryObject("commit");
            /*
             * The status the row HAS, not the one it was asked for.
             *
             * This echoed the request, so a draft save the downgrade guard
             * correctly refused still answered "draft" - the caller handed its
             * own intention back as though it were a fact. The bench reads this
             * to decide whether a receipt is finished, and a screen that trusts
             * an echo is how a panel and a database come to disagree.
             */
            return json({ data: { batchId, stoveId, status: stored } }, 200, cors);
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * What this person has on the bench, and what is waiting to be released.
       *
       * Their drafts first, because that is what somebody opens this to
       * continue. The rest of the queue is the confirmation surface's problem.
       */
      case "workbench_queue": {
        requireFeature("digitisation.work");
        return await withReadConnection(async (conn) => {
          const mine = await conn.queryObject({
            text: `select r.stove_serial_no, r.status, r.last_edited_at,
                          r.draft_values, b.organization_id::text, o.partner_name,
                          r.rejection_reason, r.rejection_hint
                     from data_center.import_rows r
                     join data_center.import_batches b on b.id = r.batch_id
                     left join public.organizations o on o.id = b.organization_id
                    where b.source = 'workbench' and r.last_edited_by = $1
                      and r.confirmed_at is null and b.state <> 'rolled_back'
                    order by r.last_edited_at desc
                    limit 200`,
            args: [userId],
          });
          const staleDays = Number(await readConfig(conn, "workbench.draft_stale_days", 7)) || 7;
          const abandoned = await conn.queryObject({
            text: `select r.stove_serial_no, r.last_edited_at, p.full_name as last_edited_by_name,
                          o.partner_name
                     from data_center.import_rows r
                     join data_center.import_batches b on b.id = r.batch_id
                     left join public.profiles p on p.id = r.last_edited_by
                     left join public.organizations o on o.id = b.organization_id
                    where b.source = 'workbench' and r.status = 'draft'
                      and r.last_edited_by is distinct from $1
                      and r.last_edited_at < now() - make_interval(days => $2::int)
                    order by r.last_edited_at
                    limit 100`,
            args: [userId, staleDays],
          });
          return json(
            { data: { mine: mine.rows, abandoned: abandoned.rows, staleDays } },
            200,
            cors,
          );
        });
      }

      /**
       * Both streams, side by side, with what is waiting on a person.
       *
       * Deliberately not one queue. A file of four hundred rows and one record
       * somebody typed are different decisions, and one button over both would
       * hide that.
       */
      case "awaiting_confirmation": {
        requireFeature("records.view");
        return await withReadConnection(async (conn) => {
          const rows = await conn.queryObject({
            text: `select batch_id::text, stream, source, filename,
                          organization_id::text, partner_name, uploaded_at,
                          uploaded_by_name,
                          awaiting::int, still_drafting::int, refused::int,
                          exceptions::int, confirmed::int, total_rows::int,
                          last_worked_on, worked_by
                     from data_center.v_awaiting_confirmation
                    where awaiting > 0 or still_drafting > 0
                    order by stream, last_worked_on desc nulls last, uploaded_at desc
                    limit 200`,
          });
          return json({ data: { batches: rows.rows } }, 200, cors);
        });
      }

      case "batches": {
        requireFeature("import.upload");
        /**
         * The history takes the same period as every other surface.
         *
         * On when the file was uploaded, which is the date this table is
         * about: a batch uploaded in March is March's work whatever dates the
         * receipts inside it carry.
         */
        const ISO = /^\d{4}-\d{2}-\d{2}$/;
        const bf = (body as { dateFrom?: string; dateTo?: string });
        const args: unknown[] = [];
        const where: string[] = [];
        if (typeof bf.dateFrom === "string" && ISO.test(bf.dateFrom)) {
          args.push(bf.dateFrom);
          where.push(`b.uploaded_at >= $${args.length}::date`);
        }
        if (typeof bf.dateTo === "string" && ISO.test(bf.dateTo)) {
          args.push(bf.dateTo);
          where.push(`b.uploaded_at < ($${args.length}::date + 1)`);
        }
        const filter = where.length > 0 ? `where ${where.join(" and ")}` : "";
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            /*
             * The counts are what the rows say now, not what validation said.
             *
             * `valid_rows` was written once, when the batch was checked, and
             * never decremented as rows committed. So a real 983-row import that
             * had already written 82 sales still offered "Commit 745" - the
             * panel disagreeing with the database, which is the one failure this
             * module keeps having and the one an operator cannot correct.
             *
             * `exception_rows` was already read live, in its own subquery. All
             * four now come from one lateral, so this is one scan of the batch's
             * rows rather than two, and no count can drift from another.
             */
            text: `select b.id, b.filename, b.state, b.total_rows,
                          counts.valid_now::int      as valid_rows,
                          counts.rejected_now::int   as rejected_rows,
                          counts.committed_now::int  as committed_rows,
                          b.uploaded_at, b.dry_run_at,
                          b.committed_at, b.last_error,
                          o.partner_name,
                          /*
                           * A batch with no partner of its own covers several,
                           * and the history showed it as "-", which reads as
                           * missing data rather than as a fact about the file.
                           * This turns a dash into "3 partners".
                           *
                           * Counted off the partner validation already recorded
                           * on each row, not by joining stock again. The first
                           * version matched on upper(stove_id), which no index
                           * can serve, so every mixed batch on the page scanned
                           * the whole stock table once per row of it. This reads
                           * a column the batch already owns.
                           */
                          case when b.organization_id is null then (
                            select count(distinct r2.normalized ->> 'resolvedOrganizationId')::int
                              from data_center.import_rows r2
                             where r2.batch_id = b.id
                               and r2.normalized ? 'resolvedOrganizationId'
                          ) end as partner_count,
                          p.full_name as uploaded_by_name,
                          counts.exception_now::int as exception_rows
                   from data_center.import_batches b
                   left join lateral (
                     select count(*) filter (where r.status = 'valid')     as valid_now,
                            count(*) filter (where r.status = 'rejected')  as rejected_now,
                            count(*) filter (where r.status = 'exception') as exception_now,
                            count(*) filter (where r.status = 'committed') as committed_now
                       from data_center.import_rows r
                      where r.batch_id = b.id
                   ) counts on true
                   left join public.organizations o on o.id = b.organization_id
                   left join public.profiles p on p.id = b.uploaded_by
                   ${filter}
                   order by b.uploaded_at desc limit 200`,
            args,
          });
          return json({ data: r.rows }, 200, cors);
        });
      }

      case "rows": {
        requireFeature("import.upload");
        const batchId = String(body.batchId ?? "");
        const status = String(body.status ?? "");
        if (!batchId) throw new BadRequest("batchId is required");
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            /**
             * `normalized` is returned beside `raw` because the two answer
             * different questions: what the operator typed, and what we
             * understood it to say. That gap is the whole of a rejected row,
             * and it matters more now that a date typed in Excel arrives as a
             * serial and is converted - "you typed 46234, we read 2026-07-31"
             * is what makes the conversion trustworthy instead of spooky.
             *
             * `sharedOnly` selects the rows that share a phone number with
             * another stove. They are valid rows, so they never appear in the
             * exceptions queue, and until this filter existed the amber flag
             * was written to the database and shown to nobody.
             */
            text: `select id, row_number, status, rejection_reason, rejection_hint,
                          exception_reason, stove_serial_no, corrected_serial, sale_id,
                          raw, normalized, shared_phone_with
                   from data_center.import_rows
                   where batch_id = $1 and ($2 = '' or status = $2)
                     and ($3::boolean is not true
                          or (shared_phone_with is not null
                              and array_length(shared_phone_with, 1) > 0))
                   order by row_number limit 300`,
            args: [batchId, status, body.sharedOnly === true],
          });
          return json({ data: r.rows }, 200, cors);
        });
      }

      default:
        return json(
          { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
          400,
          cors,
        );
    }
  } catch (err) {
    if (err instanceof BadRequest) {
      return json({ error: err.message, code: "bad_request" }, 400, resolveCors(req));
    }
    console.error("[data-center-import]", err);
    return json({ error: "Data Center import failed", code: "internal" }, 500, resolveCors(req));
  }
});

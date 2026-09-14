/**
 * The Stove DB shape (slice F4, A10): one object per sale whose keys are the
 * names the parent Stove DB uses, word for word, as the dictionary records
 * them in `stoveDbName`. Both outside doors serve it as `stove_db`; the shapes
 * they served before stay as they were.
 *
 * Values come from the columns the record holds: the name in its two parts
 * (never a guess), the sales agent as written, the address line through the
 * address row, choices as the words the agreement uses (the registry's label,
 * or the stored value when the list has no such row), CPA as the six consents
 * (D27). A field with no Stove DB name is not in the row.
 */

import { LIVE_FIELDS, type DictionaryField } from "./sale-dictionary.ts";
import { CHOICE_COLUMNS, type SaleOptionLists } from "./sale-options.ts";

type Row = Record<string, unknown>;

/** The keys of the shape, in the dictionary's order. */
export function stoveDbNames(): string[] {
  return LIVE_FIELDS.map((f) => f.stoveDbName).filter((n): n is string => Boolean(n));
}

function addressOf(sale: Row): Row | null {
  const a = (sale.address ?? sale.addresses) as Row | Row[] | null | undefined;
  if (!a) return null;
  return Array.isArray(a) ? (a[0] ?? null) : a;
}

function choiceLabel(lists: SaleOptionLists | null, listKey: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  const row = (lists?.get(listKey) ?? []).find((r) => r.value === String(value));
  return row ? row.label : value;
}

function valueOf(field: DictionaryField, sale: Row, lists: SaleOptionLists | null): unknown {
  if (field.table === "addresses") {
    return addressOf(sale)?.[field.column] ?? null;
  }
  if (field.table === "payment_models") {
    const pm = (sale.payment_model ?? sale.payment_models) as Row | null | undefined;
    return pm?.[field.column] ?? null;
  }
  if (field.table !== "sales") return null;
  const raw = sale[field.column];
  const listKey = CHOICE_COLUMNS[field.column];
  if (listKey) return choiceLabel(lists, listKey, raw);
  if (field.column === "sales_date" && raw) return String(raw).slice(0, 10);
  return raw === undefined ? null : raw;
}

/** One sale in the Stove DB shape. */
export function toStoveDbRow(sale: Row, lists: SaleOptionLists | null): Row {
  const out: Row = {};
  for (const field of LIVE_FIELDS) {
    if (!field.stoveDbName) continue;
    out[field.stoveDbName] = valueOf(field, sale, lists);
  }
  return out;
}

export function toStoveDbRows(sales: Row[], lists: SaleOptionLists | null): Row[] {
  return sales.map((s) => toStoveDbRow(s, lists));
}

/** The words a request may use for this shape. */
export function isStoveDbFormat(format: unknown): boolean {
  const f = String(format ?? "").trim().toLowerCase();
  return f === "stove_db" || f === "stovedb" || f === "format3" || f === "3";
}

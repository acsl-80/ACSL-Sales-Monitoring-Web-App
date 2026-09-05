/**
 * The sale field dictionary, for Deno.
 *
 * One JSON file, `sale-dictionary.json` beside this one, is the single source
 * of what a sale field is called (the paper User Agreement's wording), what
 * the external Stove DB calls it, where it lives, which payload key
 * create-sale and update-sale read, its type and options, and the date from
 * which it is mandatory. The web app imports the same file at build time and
 * the phone app fetches it from the `sale-dictionary` function, so a wording
 * change is one edit.
 *
 * `SALE_FIELDS` keeps the shape `sale-fields.ts` exported, derived from the
 * dictionary, so the corrections code keeps working while it moves over.
 */

import dictionary from "./sale-dictionary.json" with { type: "json" };

export type SaleFieldType =
  | "text" | "number" | "date" | "phone" | "select" | "boolean" | "money"
  | "consents" | "signature" | "image";

export type SaleFieldOption = { value: string; label: string };

export type DictionaryField = {
  key: string;
  /** The paper agreement's wording: what every reader sees. */
  label: string;
  /** What the external Stove DB API calls it; null when the API does not carry it. */
  stoveDbName: string | null;
  table: "sales" | "addresses" | "installment_payments" | "payment_models";
  column: string;
  /** The key create-sale and update-sale read; null when the field is not written that way. */
  payload: string | null;
  type: SaleFieldType;
  group: string;
  order: number;
  onAgreement: boolean;
  /** ISO date from which a new record is refused without it; null means never mandatory. */
  mandatoryFrom: string | null;
  /** Whether a correction episode may dispute and edit it. */
  correctable: boolean;
  options?: SaleFieldOption[];
  optionList?: string;
  optionsFrom?: string;
  consents?: string[];
  /** "planned" marks a field whose column arrives in a later slice. */
  status?: "planned";
  note?: string;
};

export type SaleDictionary = {
  version: string;
  source: string;
  groups: { key: string; label: string }[];
  fields: DictionaryField[];
};

export const SALE_DICTIONARY = dictionary as SaleDictionary;

/** Fields whose column exists today. */
export const LIVE_FIELDS: readonly DictionaryField[] = SALE_DICTIONARY.fields.filter((f) => f.status !== "planned");

const BY_KEY = new Map(SALE_DICTIONARY.fields.map((f) => [f.key, f]));

export function fieldByKey(key: string): DictionaryField | undefined {
  return BY_KEY.get(key);
}

/** The agreement's wording for a field, or the key spelled as words when unknown. */
export function fieldLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key.replace(/_id$/, "").replace(/_/g, " ");
}

/**
 * True when the field is mandatory for a record dated `on` (default today).
 * A record dated before the field's mandatory-from date is never refused
 * for lacking it: history is judged by the rule of its day.
 */
export function isMandatory(field: DictionaryField, on: Date = new Date()): boolean {
  if (!field.mandatoryFrom) return false;
  return on.toISOString().slice(0, 10) >= field.mandatoryFrom;
}

/**
 * The shape `sale-fields.ts` exported, for the corrections code: the
 * correctable fields with their update-sale payload key. `required` names
 * what update-sale refuses a body without, which is unchanged by the
 * dictionary until slice F3 moves that rule into configuration.
 */
const UPDATE_SALE_REQUIRES = new Set(["end_user_name", "phone", "contact_person", "contact_phone"]);

export type SaleFieldGroup = string;
export type SaleField = {
  key: string;
  label: string;
  group: SaleFieldGroup;
  payload: string | null;
  required: boolean;
};

export const SALE_FIELDS: readonly SaleField[] = LIVE_FIELDS
  .filter((f) => f.correctable || f.key === "stove_serial_no" || f.type === "image")
  .map((f) => ({
    key: f.key,
    label: f.label,
    group: f.group,
    payload: f.payload,
    required: UPDATE_SALE_REQUIRES.has(f.key),
  }));

const KEYS = new Set(SALE_FIELDS.map((f) => f.key));

/** True when every key names a field in the catalogue. */
export function knownSaleFields(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.every((k) => typeof k === "string" && KEYS.has(k));
}

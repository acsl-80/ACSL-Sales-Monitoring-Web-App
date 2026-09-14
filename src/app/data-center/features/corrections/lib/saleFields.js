/**
 * The fields a correction may dispute, read from the sale dictionary.
 *
 * This was a hand copy of `supabase/functions/_shared/sale-fields.ts` kept in
 * step by eye. Both now read the same JSON, so the words on the panel are the
 * words the edge function validates against and the words the paper User
 * Agreement uses.
 *
 * `payload` is the key `update-sale` reads; null means the field is not edited
 * through it (the serial number goes through the module's own rematch, the two
 * images through the sales app's uploads). `required` names what `update-sale`
 * refuses a body without, so the panel always sends those, prefilled from the
 * sale.
 */

import { LIVE_FIELDS, SALE_DICTIONARY } from "@/lib/saleDictionary";

/** What `update-sale` refuses a body without. Unchanged by the dictionary. */
const UPDATE_SALE_REQUIRES = new Set([
  "end_user_name",
  "phone",
  "contact_person",
  "contact_phone",
]);

/**
 * The correctable fields, plus the serial number and the two images.
 *
 * The same rule the Deno side applies, so the catalogue the corrections
 * function hands back and the catalogue this panel draws from are one list.
 */
export const SALE_FIELDS = LIVE_FIELDS.filter(
  (f) => f.correctable || f.key === "stove_serial_no" || f.type === "image",
).map((f) => ({
  key: f.key,
  label: f.label,
  group: f.group,
  payload: f.payload,
  required: UPDATE_SALE_REQUIRES.has(f.key),
}));

/**
 * The section headings, from the dictionary's own groups.
 *
 * "money" is kept because episodes recorded before the dictionary named that
 * group, and a heading the map does not know would render as a bare key.
 */
export const GROUP_LABELS = {
  ...Object.fromEntries(SALE_DICTIONARY.groups.map((g) => [g.key, g.label])),
  money: "Money",
};

/** The group the money fields sit in, so a consumer never spells it twice. */
export const MONEY_GROUP = "payment";

/**
 * Fields the edit panel can put a control on: everything `update-sale`
 * actually reads, except the signature.
 *
 * The signature is drawn, not typed. `retailer_branch` carries a payload key
 * in the dictionary but `update-sale` does not destructure `retailerBranch`,
 * so a control for it would accept a correction and drop it in silence, which
 * is the one kind of failure an operator cannot see. It comes off the panel
 * until the function reads it.
 */
const NOT_READ_BY_UPDATE_SALE = new Set(["signature"]);

export const EDITABLE = SALE_FIELDS.filter(
  (f) => f.payload && !NOT_READ_BY_UPDATE_SALE.has(f.key),
);

export const byKey = Object.fromEntries(SALE_FIELDS.map((f) => [f.key, f]));

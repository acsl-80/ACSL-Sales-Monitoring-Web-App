/**
 * The fields of a sale a correction may dispute, and how each is edited.
 *
 * Code rather than configuration because every row binds to `update-sale`'s
 * payload contract: renaming a payload key there is a deploy, and a registry
 * row pointing at a key that no longer exists would fail at the worst moment,
 * with a sales rep holding the receipt. Which fields a REASON points at is
 * configuration (`workflow_config` key `corrections.reason_fields`); this file
 * is the vocabulary that configuration may use.
 *
 * `payload` is the key `update-sale` reads. `null` means the field is not
 * edited through `update-sale` at all: the stove ID goes through the module's
 * own `serial_rematch`, and the two images through the sales app's uploads.
 *
 * The client mirror is `src/app/data-center/features/corrections/lib/saleFields.js`;
 * the two are kept in step by hand, the way roles and features are.
 */

export type SaleFieldGroup = "buyer" | "where" | "stove" | "money" | "sale" | "evidence";

export type SaleField = {
  key: string;
  label: string;
  group: SaleFieldGroup;
  /** The `update-sale` payload key, or null when the field is not edited there. */
  payload: string | null;
  /** `update-sale` refuses a body without these, so the panel always sends them. */
  required: boolean;
};

export const SALE_FIELDS: readonly SaleField[] = [
  { key: "end_user_name", label: "End user name", group: "buyer", payload: "endUserName", required: true },
  { key: "aka", label: "Also known as", group: "buyer", payload: "aka", required: false },
  { key: "phone", label: "Phone", group: "buyer", payload: "phone", required: true },
  { key: "other_phone", label: "Other phone", group: "buyer", payload: "otherPhone", required: false },
  { key: "contact_person", label: "Contact person", group: "buyer", payload: "contactPerson", required: true },
  { key: "contact_phone", label: "Contact phone", group: "buyer", payload: "contactPhone", required: true },
  { key: "full_address", label: "Address", group: "where", payload: "addressData", required: false },
  { key: "state_backup", label: "State", group: "where", payload: "stateBackup", required: false },
  { key: "lga_backup", label: "LGA", group: "where", payload: "lgaBackup", required: false },
  { key: "stove_serial_no", label: "Stove ID", group: "stove", payload: null, required: false },
  { key: "sales_date", label: "Sale date", group: "sale", payload: "salesDate", required: false },
  { key: "pot_quantity", label: "Pots", group: "sale", payload: "potQuantity", required: false },
  { key: "heat_retention_device", label: "Heat retention device", group: "sale", payload: "heatRetentionDevice", required: false },
  { key: "previous_stove_type", label: "Previous stove", group: "sale", payload: "previousStoveType", required: false },
  { key: "previous_stove_other", label: "Previous stove, other", group: "sale", payload: "previousStoveOther", required: false },
  { key: "meals_per_day", label: "Meals per day", group: "sale", payload: "mealsPerDay", required: false },
  { key: "cooking_fuel_source", label: "Cooking fuel", group: "sale", payload: "cookingFuelSource", required: false },
  { key: "cooking_location", label: "Cooking location", group: "sale", payload: "cookingLocation", required: false },
  { key: "amount", label: "Amount", group: "money", payload: "amount", required: false },
  { key: "total_paid", label: "Amount received", group: "money", payload: "amountReceived", required: false },
  { key: "signature", label: "Signature", group: "evidence", payload: "signature", required: false },
  { key: "agreement_image_id", label: "Agreement image", group: "evidence", payload: null, required: false },
  { key: "stove_image_id", label: "Stove image", group: "evidence", payload: null, required: false },
] as const;

const KEYS = new Set(SALE_FIELDS.map((f) => f.key));

/** True when every key names a field in the catalogue. */
export function knownSaleFields(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.every((k) => typeof k === "string" && KEYS.has(k));
}

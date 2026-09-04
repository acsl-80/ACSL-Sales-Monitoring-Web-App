/**
 * The client mirror of `supabase/functions/_shared/sale-fields.ts`.
 *
 * Kept in step by hand, the way roles and features are. `payload` is the key
 * `update-sale` reads; null means the field is not edited through it (the
 * stove ID goes through the module's own rematch, the two images through the
 * sales app's uploads). `required` names what `update-sale` refuses a body
 * without, so the panel always sends those, prefilled from the sale.
 */

export const SALE_FIELDS = [
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
];

export const GROUP_LABELS = {
  buyer: "Buyer",
  where: "Where",
  stove: "Stove",
  sale: "The sale",
  money: "Money",
  evidence: "Evidence",
};

/** Fields the edit panel can put a control on: everything with an update-sale key except the signature. */
export const EDITABLE = SALE_FIELDS.filter((f) => f.payload && f.key !== "signature");

export const byKey = Object.fromEntries(SALE_FIELDS.map((f) => [f.key, f]));

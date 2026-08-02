// Single source of truth for a sale's completeness status.
//
// This mirrors `validateSalesForm` in src/app/utils/salesFormValidation.js —
// whatever the create/edit form marks required is what makes a sale complete.
// Keep the two in step: if a field's required-ness changes on the form, change
// it here too, otherwise `status` silently drifts from what operators see.
//
// Deliberately NOT part of the calculation:
//   - stove image      — optional on the form
//   - agreement image  — optional on the form
//   - retailer branch  — shown as required, but a null branch is acceptable
//   - amount, terms    — hard-rejected with a 400 before we ever get here,
//                        so they can never be missing on a persisted sale

export type SaleStatus = "completed" | "pending" | "incomplete";

export interface SaleStatusInput {
  transactionId?: unknown;
  stoveSerialNo?: unknown;
  salesDate?: unknown;
  contactPerson?: unknown;
  contactPhone?: unknown;
  endUserName?: unknown;
  phone?: unknown;
  partnerName?: unknown;
  amount?: unknown;
  stateBackup?: unknown;
  lgaBackup?: unknown;
  fullAddress?: unknown;
  signature?: unknown;
}

/** Mirrors `isValidSignature` in src/app/utils/signatureUtils.js. */
export function isValidSignature(signature: unknown): boolean {
  if (typeof signature !== "string") return false;
  const s = signature.trim();
  if (s.length === 0) return false;
  if (s.startsWith("data:image/")) return s.length > 22;
  return s.length > 100;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

/**
 * Resolves a sale's status from the fields the sales form requires.
 *
 *   completed  — every required field present AND a valid signature
 *   pending    — every required field present, signature missing or invalid
 *   incomplete — at least one required field missing
 */
/** Names of the required fields that are absent — empty when the sale is complete. */
export function missingRequiredFields(input: SaleStatusInput): string[] {
  const required: Array<[string, unknown]> = [
    ["transactionId", input.transactionId],
    ["stoveSerialNo", input.stoveSerialNo],
    ["salesDate", input.salesDate],
    ["contactPerson", input.contactPerson],
    ["contactPhone", input.contactPhone],
    ["endUserName", input.endUserName],
    ["phone", input.phone],
    ["partnerName", input.partnerName],
    ["amount", input.amount],
    ["stateBackup", input.stateBackup],
    ["lgaBackup", input.lgaBackup],
    ["fullAddress", input.fullAddress],
  ];
  const missing = required.filter(([, v]) => !isPresent(v)).map(([name]) => name);
  if (!isValidSignature(input.signature)) missing.push("signature");
  return missing;
}

export function resolveSaleStatus(input: SaleStatusInput): SaleStatus {
  const missing = missingRequiredFields(input);
  if (missing.some((f) => f !== "signature")) return "incomplete";
  return missing.length === 0 ? "completed" : "pending";
}

/** Column shape as stored in `sales` (+ the joined address), for recomputation. */
export interface SaleRow {
  transaction_id?: unknown;
  stove_serial_no?: unknown;
  sales_date?: unknown;
  contact_person?: unknown;
  contact_phone?: unknown;
  end_user_name?: unknown;
  phone?: unknown;
  partner_name?: unknown;
  amount?: unknown;
  state_backup?: unknown;
  lga_backup?: unknown;
  signature?: unknown;
  address?: { full_address?: unknown } | null;
}

/** Maps a persisted row onto the predicate's input shape. */
export function saleStatusInputFromRow(row: SaleRow): SaleStatusInput {
  return {
    transactionId: row.transaction_id,
    stoveSerialNo: row.stove_serial_no,
    salesDate: row.sales_date,
    contactPerson: row.contact_person,
    contactPhone: row.contact_phone,
    endUserName: row.end_user_name,
    phone: row.phone,
    partnerName: row.partner_name,
    amount: row.amount,
    stateBackup: row.state_backup,
    lgaBackup: row.lga_backup,
    fullAddress: row.address?.full_address,
    signature: row.signature,
  };
}

/** Recomputes status from a persisted row — used by update-sale and the backfill. */
export function resolveSaleStatusFromRow(row: SaleRow): SaleStatus {
  return resolveSaleStatus(saleStatusInputFromRow(row));
}

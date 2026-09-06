/**
 * What is left of the sales app's status rule in TypeScript.
 *
 * Since slice F3a the rule lives in one place: public.calculate_sale_status,
 * which reads public.sale_field_rules and runs before every insert and update
 * of public.sales. create-sale and update-sale no longer compute a status;
 * they read the row's status back after writing it. The field list that used
 * to sit here, mirrored by hand, is gone with it.
 *
 * The signature test stays because the web form's validator and the SQL
 * function both quote it, and it has no other home.
 */

export type SaleStatus = "completed" | "pending" | "incomplete";

/**
 * A signature counts when it is a data URL with something after the prefix,
 * or any other string long enough to be more than a placeholder.
 */
export function isValidSignature(signature: unknown): boolean {
  if (typeof signature !== "string") return false;
  const s = signature.trim();
  if (s.length === 0) return false;
  if (s.startsWith("data:image/")) return s.length > 22;
  return s.length > 100;
}

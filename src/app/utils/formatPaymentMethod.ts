/**
 * A payment method as words: `bank_transfer` reads "Bank Transfer".
 *
 * One copy, shared. The payment history modal had this helper and the sales
 * detail modal rendered the raw value under CSS `capitalize`, so the same
 * field read "Bank Transfer" on one screen and "Bank_transfer" on the next.
 */
export const formatPaymentMethod = (method: string | null | undefined): string => {
  if (!method) return "-";
  return method
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

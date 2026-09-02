/**
 * Which door of create-sale a row can go through, decided in one place.
 *
 * create-sale has two doors. The outright door coerces "paid" to the full
 * amount, by the sales app's own rule, so a receipt that states a part payment
 * must not be sent through it: 3,500 received against 42,000 would be written
 * as 42,000 received. The installment door lets paid be what was actually
 * received, but it needs a payment model to track the balance against.
 *
 * So a row with no model can only be written when the buyer paid in full. A
 * row with a model always has a door. Anything else has no door, and the
 * reason says so by name.
 *
 * This used to live inline in the commit, which meant a batch could pass the
 * check, show as ready, and then have every row refused at the moment of
 * writing - on 2026-09-02 that was twenty-five typed receipts, four batches
 * stamped "committed" with nothing written. The bench, the check and the
 * commit now all ask this one function, so a row that will be refused is
 * refused where the person who can fix it is looking.
 */

export type PaymentDoor =
  | { door: "installment"; paymentModelId: string }
  | { door: "outright" }
  | { door: null; reason: string; field: "salesModel" | "amountReceived" };

export const NO_MODEL_PART_PAID =
  "This row names no sales model but states a part payment, and a part payment " +
  "needs a sales model to be tracked against. Add the model, then check the batch again.";

export const NO_MODEL_NO_RECEIVED =
  "This row names no sales model and states no amount received. Paid is only ever " +
  "what was stated - add the sales model (so the balance can be tracked) or the " +
  "amount received, then check the batch again.";

export function paymentDoorFor(row: {
  amount: number;
  amountReceived: number | null;
  paymentModelId?: string | null;
}): PaymentDoor {
  const modelId = typeof row.paymentModelId === "string" && row.paymentModelId
    ? row.paymentModelId
    : null;
  if (modelId) return { door: "installment", paymentModelId: modelId };
  const stated = row.amountReceived;
  const paidInFull = stated !== null && stated !== undefined &&
    Number(stated) === Number(row.amount);
  if (paidInFull) return { door: "outright" };
  return stated === null || stated === undefined
    ? { door: null, reason: NO_MODEL_NO_RECEIVED, field: "salesModel" }
    : { door: null, reason: NO_MODEL_PART_PAID, field: "salesModel" };
}

/** The bench's version of the same refusal: what the typist should do next. */
export function benchHintFor(door: PaymentDoor): string | null {
  if (door.door !== null) return null;
  return door.reason === NO_MODEL_NO_RECEIVED
    ? "Pick the sales model on the receipt, or fill in Amount paid if the buyer paid in full."
    : "The buyer has not paid in full, and the balance is tracked against the sales model. " +
      "Pick the model on the receipt.";
}

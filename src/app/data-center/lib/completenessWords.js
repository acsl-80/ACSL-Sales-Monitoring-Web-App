import { fieldLabel } from "@/lib/saleDictionary";

/**
 * The words for each part of the completeness rule, in the lower case a
 * sentence needs: "missing serial number" on a chip, "Missing telephone
 * number" on the dashboard. Derived from the dictionary so the chip and the
 * form never disagree; the two parts the dictionary does not name (the
 * transfer reference, which is not on the agreement, and the evidence
 * clause, which is a rule rather than a field) are written here.
 */
const OVERRIDES = {
  transaction_id: "transfer reference",
  evidence: "evidence (a signature or a paper agreement)",
};

export function fieldWords(key) {
  if (OVERRIDES[key]) return OVERRIDES[key];
  const label = fieldLabel(key);
  // Keep an acronym its capitals: "LGA" reads wrong as "lga".
  return label === label.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

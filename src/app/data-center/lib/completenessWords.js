/**
 * The words for each part of the completeness rule.
 *
 * The rule lives in workflow_config as column names; the dashboard, the
 * filter panel and the drill banner all need to say them to a person. One
 * map, so "address_id" is "address" on every surface, and a field the map
 * does not know still reads as words rather than as a column name.
 */
const WORDS = {
  transaction_id: "transfer reference",
  stove_serial_no: "stove ID",
  end_user_name: "buyer's name",
  phone: "phone",
  contact_person: "contact person",
  contact_phone: "contact phone",
  amount: "amount",
  address_id: "address",
  signature: "signature",
  stove_image_id: "stove photo",
  agreement_image_id: "agreement document",
  evidence: "evidence (a signature or a paper agreement)",
};

export function fieldWords(key) {
  return WORDS[key] ?? String(key).replace(/_id$/, "").replace(/_/g, " ");
}

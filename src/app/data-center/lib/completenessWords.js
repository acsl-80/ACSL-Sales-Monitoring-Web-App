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
  // The agreement's wording, in the lower case a sentence needs: these read
  // as "missing serial number" on a chip and "Missing telephone number" on
  // the dashboard, so they are the dictionary's words rather than its casing.
  stove_serial_no: "serial number",
  end_user_name: "customer name",
  phone: "telephone number",
  contact_person: "buyer name",
  contact_phone: "contact phone",
  amount: "total amount",
  address_id: "address",
  signature: "signature",
  stove_image_id: "stove photo",
  agreement_image_id: "agreement document",
  evidence: "evidence (a signature or a paper agreement)",
};

export function fieldWords(key) {
  return WORDS[key] ?? String(key).replace(/_id$/, "").replace(/_/g, " ");
}

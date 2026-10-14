/**
 * Who a sale's buyer is, as one short key: the phone number and the name,
 * written however the agent typed them, reduced to the same thing.
 *
 * The rule it serves (docs/plans/phone-and-buyer-rule.md): one phone number can
 * sit on several sales, because a household shares a phone; the same name on
 * the same number is the same customer entered twice. So two sales are "the
 * same buyer" when their keys are equal, and only then.
 *
 * The phone app computes the same key in Dart and compares it offline against
 * keys the server sends, so a device never holds a list of customer names.
 * Every implementation must reproduce `buyer-key-vectors.json`; the e2e spec
 * host-phone-buyer-groundwork checks this one against it.
 *
 * The title list is configuration (`buyer-key-rules.json`), served to the
 * clients rather than typed into them, so it can change without a release.
 *
 * No imports and only Web Crypto, so Deno, Node and the browser can all load it.
 */
import rules from "./buyer-key-rules.json" with { type: "json" };

export const BUYER_KEY_RULES: { version: string; titles: string[] } = rules;

/** The last ten digits, or "" when there are fewer than ten. */
export function phoneTail(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length < 10 ? "" : digits.slice(-10);
}

/**
 * The name, reduced: aliases in brackets dropped, ASCII lower case, punctuation
 * inside a word removed, titles dropped, words sorted. First name and surname
 * win when either is present; otherwise the joined name is used. The sales
 * trigger keeps the joined name equal to the two parts whenever they exist, so
 * both routes give the same key for one stored sale.
 */
export function nameKey(
  firstName: unknown,
  surname: unknown,
  joinedName: unknown,
  titles: readonly string[] = BUYER_KEY_RULES.titles,
): string {
  const parts = [firstName, surname].map((s) => String(s ?? "").trim()).filter(Boolean);
  let s = parts.length ? parts.join(" ") : String(joinedName ?? "");
  s = s.replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
  s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  s = s.replace(/[\s,/]+/g, " ");
  s = s.replace(/[^a-z ]/g, "");
  return s
    .split(" ")
    .filter((w) => w && !titles.includes(w))
    .sort()
    .join(" ");
}

/**
 * The first 16 hex characters of SHA-256 over `<tail>|<name key>`, or "" when
 * either half is empty (then only the shared-number note can apply).
 */
export async function buyerKey(
  phone: unknown,
  firstName: unknown,
  surname: unknown,
  joinedName: unknown,
  titles: readonly string[] = BUYER_KEY_RULES.titles,
): Promise<string> {
  const tail = phoneTail(phone);
  const name = nameKey(firstName, surname, joinedName, titles);
  if (!tail || !name) return "";
  const bytes = new TextEncoder().encode(`${tail}|${name}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest.subarray(0, 8)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

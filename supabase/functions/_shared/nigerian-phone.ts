/**
 * Nigerian phone numbers, as spreadsheets actually contain them.
 *
 * The import validated with one regex, `^(?:0|\+?234)[7-9][0-1]\d{8}$`, after
 * stripping spaces and dashes. That accepts three shapes and refuses every
 * other way a real file writes the same number, and the commonest refusal is
 * the one nobody causes on purpose: Excel treats a column of digits as numbers
 * and eats the leading zero, so 08012345678 arrives as 8012345678 and the row
 * is rejected for a number that is perfectly correct.
 *
 * It also only ever validated. Production carries the consequence: 27 sales
 * hold 0XXXXXXXXXX, seven hold +234XXXXXXXXXX, two hold 234XXXXXXXXXX, and
 * three hold something that is not a phone number at all. A call agent
 * searching for a buyer by number finds them or does not depending on which
 * shape the typist used.
 *
 * So this normalises rather than judges, and everything that writes a number
 * goes through it. One stored shape, 0XXXXXXXXXX, which is what the sales app
 * and the call centre already expect.
 */

/** Every operator prefix in service, as the second and third digits. */
const NG_MOBILE = /^[789][01]\d{8}$/;

export type PhoneResult =
  | { ok: true; phone: string; changed: boolean }
  | { ok: false; reason: string; hint: string };

/**
 * Reduce a number to its ten significant digits, whatever wrapping it arrived
 * in, then put it back in the one shape this system stores.
 *
 * Deliberately generous about the input and strict about the output. Being
 * strict about the input rejects work that is not wrong, and the person who
 * has to fix it is a digitiser with 400 more rows to type.
 */
export function normalizeNigerianPhone(input: unknown): PhoneResult {
  if (input === null || input === undefined) {
    return {
      ok: false,
      reason: "No phone number",
      hint: "Add the buyer's phone number, for example 08012345678.",
    };
  }

  let raw = String(input).trim();
  if (!raw) {
    return {
      ok: false,
      reason: "No phone number",
      hint: "Add the buyer's phone number, for example 08012345678.",
    };
  }

  // A spreadsheet cell formatted as a number arrives as 8012345678.0, and as
  // 8.01234568e9 once it is long enough. The second is unrecoverable: the
  // exponent form has already lost digits, so it is refused rather than
  // guessed at.
  if (/e\+?\d+$/i.test(raw)) {
    return {
      ok: false,
      reason: `"${raw}" is a rounded number, not a phone number`,
      hint:
        "Excel turned this column into numbers and lost digits. Format the phone column as Text in the spreadsheet and paste the numbers again.",
    };
  }
  raw = raw.replace(/\.0+$/, "");

  // Everything a person or a spreadsheet puts around the digits.
  const digits = raw.replace(/[\s()\-.‐-―]/g, "");

  let national: string | null = null;
  if (/^\+?234\d{10}$/.test(digits)) {
    // +2348012345678 or 2348012345678
    national = digits.replace(/^\+?234/, "");
  } else if (/^0\d{10}$/.test(digits)) {
    // 08012345678, the shape this system stores
    national = digits.slice(1);
  } else if (/^\d{10}$/.test(digits)) {
    // 8012345678: Excel ate the leading zero. The single most common reason a
    // correct number was rejected.
    national = digits;
  } else if (/^00234\d{10}$/.test(digits)) {
    // The international prefix some handsets write instead of +.
    national = digits.slice(5);
  }

  if (national === null) {
    return {
      ok: false,
      reason: `"${raw}" is not a Nigerian phone number`,
      hint:
        "It needs eleven digits starting 0, like 08012345678. +234 and 234 are fine too, and so are spaces and dashes.",
    };
  }

  if (!NG_MOBILE.test(national)) {
    return {
      ok: false,
      reason: `"${raw}" is not a Nigerian mobile number`,
      hint:
        "Nigerian mobile numbers start 070, 080, 081, 090 or 091 and are eleven digits in total.",
    };
  }

  const phone = `0${national}`;
  return { ok: true, phone, changed: phone !== raw };
}

/** True when the value is a usable Nigerian mobile number in any shape. */
export function isNigerianPhone(input: unknown): boolean {
  return normalizeNigerianPhone(input).ok;
}

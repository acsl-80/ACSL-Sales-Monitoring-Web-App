/**
 * Reading a date a spreadsheet has already had its way with.
 *
 * A person types 14/07/2026 into Excel and the file that arrives carries
 * 46217. Not a bug on their side and not something they can see, so the import
 * has to understand both.
 *
 * The epoch is 1899-12-30 rather than 1900-01-01 because Excel believes 1900
 * was a leap year. Serials above 59 are all shifted by that phantom day, and
 * every date this system will ever see is far above 59.
 *
 * Bounded to 2015-2100 on purpose. An unbounded reading would turn any stray
 * number typed into the wrong column into a confident, wrong date; outside the
 * window the row is still refused, and the operator still gets told why.
 *
 * Shared rather than copied: the receipt import and the call-centre import
 * both read dates out of the same spreadsheets, and two copies of a date
 * parser is two answers to "what year is 46217" the first time one is fixed.
 */

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_MIN = 42005; // 2015-01-01
const EXCEL_MAX = 73051; // 2100-01-01

export function excelSerialToIso(value: string): string | null {
  if (!/^\d{4,5}(\.0+)?$/.test(value.trim())) return null;
  const serial = Math.trunc(Number(value));
  if (!Number.isFinite(serial) || serial < EXCEL_MIN || serial > EXCEL_MAX) return null;
  return new Date(EXCEL_EPOCH_MS + serial * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A date column, however the spreadsheet chose to hand it over.
 *
 * Returns an ISO date, or null when the value is empty. Throws its own reason
 * when the value is present and unreadable, because a date the import cannot
 * parse is a row a person has to look at, not a null to write down.
 */
export function readSheetDate(value: unknown, columnName: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const serial = excelSerialToIso(raw);
  if (serial) return serial;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.slice(0, 10);
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }

  // dd/mm/yyyy and dd-mm-yyyy, which is how it is written here. Deliberately
  // NOT month-first: a sheet from Kano saying 07/08/2026 means 7 August, and
  // guessing the other way round would be wrong on two days in three.
  const parts = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (parts) {
    const [, d, m, y] = parts;
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }

  throw new Error(
    `${columnName} reads "${raw}", which is not a date this can understand. ` +
      "Use 2026-07-14, or format the column as Date in the spreadsheet.",
  );
}

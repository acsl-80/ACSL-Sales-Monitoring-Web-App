import { dataCenterImport, type ImportRow } from "./client";
import { toCsv, downloadCsv } from "./export";

/**
 * The rows that did not land, as a file somebody can fix and upload again.
 *
 * WHY THIS EXISTS AS A FEATURE RATHER THAN A SCRIPT
 *
 * A real 983-row import produced 331 exceptions. Getting them back out for
 * correction took a hand-written script and days of cleanup, and the workbook
 * that script produced - every original column, the offending value, the
 * reason, and what to do about it - was the single most useful artifact of the
 * whole exercise. It existed nowhere in the app. This is that workbook, as a
 * button.
 *
 * WHY IT CARRIES `raw` AND NOT `normalized`
 *
 * `raw` is what the person typed, in their own column names. `normalized` is
 * what we understood, which is exactly the thing in dispute when a row did not
 * land. A correction file has to be the file they recognise.
 *
 * THE CEILING IS STATED, NEVER SILENT
 *
 * `rows` is capped at 1000 server-side with no cursor. On the 983-row file
 * that was invisible; at the 20,000 rows `import.max_rows` allows it is not.
 * A truncated correction file is the worst kind of wrong, because the rows it
 * silently omits are exactly the ones nobody then chases. So the caller is
 * told, and the file says so in its own last column.
 */

const CAP = 1000;

export type ReworkResult = {
  rows: number;
  /** True when either status hit the server's row cap, so this is partial. */
  truncated: boolean;
  filename: string;
};

/**
 * Build and download the correction file for a batch.
 *
 * Covers BOTH failure classes. The receipt panel's existing export covers
 * rejections only, which on the call side would be an empty file: nearly every
 * call failure is an exception (no sale yet, a stale version, an option label
 * the registry does not know) rather than an unreadable row.
 */
export async function downloadRework(
  batchId: string,
  opts: { noun?: string; stem?: string } = {},
): Promise<ReworkResult> {
  const [exceptions, rejected] = await Promise.all([
    dataCenterImport.rows(batchId, "exception"),
    dataCenterImport.rows(batchId, "rejected"),
  ]);

  const truncated = exceptions.length >= CAP || rejected.length >= CAP;

  const tagged = [
    ...exceptions.map((r) => ({ row: r, kind: "Needs a person" })),
    ...rejected.map((r) => ({ row: r, kind: "Could not be read" })),
  ].sort((a, b) => (a.row.row_number ?? 0) - (b.row.row_number ?? 0));

  // Every column any failing row carried, in first-seen order. A union rather
  // than the first row's keys, because a sheet edited by several people is not
  // always ragged in the same way.
  const headers: string[] = [];
  for (const { row } of tagged) {
    for (const k of Object.keys((row.raw as Record<string, unknown>) ?? {})) {
      if (!headers.includes(k)) headers.push(k);
    }
  }

  const out = tagged.map(({ row, kind }) => {
    const raw = (row.raw as Record<string, unknown>) ?? {};
    return {
      "Row in file": row.row_number,
      ...Object.fromEntries(headers.map((h) => [h, raw[h] ?? ""])),
      "What happened": kind,
      "Why it did not land": row.exception_reason ?? row.rejection_reason ?? "",
      "How to fix it": row.rejection_hint ?? "",
    };
  });

  const columns = [
    "Row in file",
    ...headers,
    "What happened",
    "Why it did not land",
    "How to fix it",
  ];

  const stem = opts.stem ?? "rows-to-fix";
  const filename = `${stem}-${batchId.slice(0, 8)}.csv`;
  downloadCsv(filename, toCsv(out, columns));

  return { rows: out.length, truncated, filename };
}

/**
 * How many rows a correction file would carry, without building it.
 *
 * Used to label the button with a number, so somebody can tell at a glance
 * whether pressing it is worth doing.
 */
export function reworkCount(rows: ImportRow[]): number {
  return rows.filter((r) => r.status === "exception" || r.status === "rejected").length;
}

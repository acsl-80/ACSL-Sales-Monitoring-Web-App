/**
 * CSV export, in about thirty lines.
 *
 * Every scorecard and every table it drills into exports, because the numbers
 * have to be able to leave the app for analysis. Written here rather than taken
 * as a dependency for the same reason as the CSV reader and the virtualization:
 * a dependency means editing package.json and bun.lock, which the daily
 * contractor merge touches.
 *
 * The quoting is the part that matters. A partner called
 * "Swali Global Multi Concept (Amina Sales Model), Kano" contains a comma, and
 * a naive join would silently split it across two columns in whatever opens it.
 */

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote when the value could otherwise change the shape of the row, and
  // double any quote inside it, which is what RFC 4180 asks for.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Rows to CSV text, taking the given columns in the given order. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  const header = columns.map(escape).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(","));
  return [header, ...body].join("\r\n");
}

/**
 * Hand the file to the browser.
 *
 * The BOM is not decoration: without it Excel reads UTF-8 as its local
 * codepage, and every Nigerian name with an accent arrives mangled.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

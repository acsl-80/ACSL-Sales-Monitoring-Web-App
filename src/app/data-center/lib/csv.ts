/**
 * A CSV reader, in about sixty lines.
 *
 * WHY NOT PAPAPARSE
 *
 * Same reason the table is not using @tanstack/react-virtual: taking a
 * dependency means editing package.json and bun.lock, both of which sit in the
 * sync workflow's HIGH_RISK list and are touched by the daily contractor merge.
 * The module's delivery promise is that it changes exactly two shared files.
 *
 * What it handles is what a spreadsheet export actually produces: quoted
 * fields, escaped quotes inside them, commas and newlines inside quotes, CRLF,
 * and a UTF-8 byte order mark. What it does not handle is a custom delimiter or
 * a file whose header row is not the first row. Both would be a reason to take
 * a real parser rather than to grow this one.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Populated when the file is readable but something about it is odd. */
  warnings: string[];
}

export class CsvError extends Error {}

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Consume CRLF as one break rather than producing an empty record.
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(text: string): ParsedCsv {
  // Excel writes a byte order mark, which would otherwise become part of the
  // first column's name and make every lookup on it miss.
  const clean = text.replace(/^﻿/, "");
  const records = splitRecords(clean).filter(
    (r) => r.length > 1 || (r[0] ?? "").trim() !== "",
  );

  if (records.length === 0) throw new CsvError("That file is empty.");
  if (records.length === 1) throw new CsvError("That file has a header row and nothing else.");

  const headers = records[0].map((h) => h.trim());
  const warnings: string[] = [];

  const blank = headers.filter((h) => h === "").length;
  if (blank > 0) warnings.push(`${blank} column(s) have no name and were ignored.`);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const record = records[i];
    if (record.length !== headers.length) {
      warnings.push(
        `Row ${i + 1} has ${record.length} values against ${headers.length} columns. It was read as far as it goes.`,
      );
    }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h !== "") row[h] = (record[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows, warnings };
}

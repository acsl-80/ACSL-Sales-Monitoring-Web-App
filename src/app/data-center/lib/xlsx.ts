/**
 * Writing a workbook, by hand, because a dependency is not available here.
 *
 * The sheet digitisers type into was a CSV, and a CSV cannot carry a dropdown.
 * That is not a small loss: the form offers "charcoal", and a typist with a
 * blank cell writes "Charcoal stove", "CHARCOAL" or "chacoal", and every one of
 * those is a row the import refuses for a value the person had no way of
 * knowing. Dropdowns move that whole class of failure from after the upload to
 * before it.
 *
 * `package.json` and `bun.lock` are in the daily contractor merge, so a
 * spreadsheet library is not an option. An .xlsx is a ZIP of XML, and a ZIP
 * whose entries are stored rather than deflated needs no compression at all -
 * only CRC-32 and the header layout. That is what this is: about two hundred
 * lines instead of a lockfile conflict.
 *
 * Deliberately minimal. One sheet, strings and dropdowns, no styling beyond a
 * bold header and column widths. Anything more belongs in a library, and if
 * this ever needs more than this it is time to argue for one.
 */

/* ------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Bytes): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Always over a plain ArrayBuffer: a Blob cannot take a shared one. */
type Bytes = Uint8Array<ArrayBuffer>;

type Entry = { name: string; bytes: Bytes };

/**
 * A ZIP with stored entries.
 *
 * Every reader accepts stored: it is method 0 in the spec and predates
 * deflate. The file is larger than a compressed one, and a sheet of a few
 * hundred rows is tens of kilobytes either way.
 */
function zip(entries: Entry[]): Blob {
  const chunks: Bytes[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), // no timestamp: a stable file is easier to diff
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, entry.bytes);

    central.push(
      new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,
        ...u16(20), ...u16(20), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0),
        ...u32(crc), ...u32(size), ...u32(size),
        ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0),
        ...u32(offset),
      ]),
      name,
    );
    offset += local.length + name.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset),
    ...u16(0),
  ]);

  return new Blob([...chunks, ...central, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ------------------------------------------------------------------- xml */

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const bytes = (s: string): Bytes => new TextEncoder().encode(s) as Bytes;

/** A1, B1 ... AA1. Excel's column names, which are base-26 with no zero. */
export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export type SheetColumn = {
  header: string;
  /** When present, the cell becomes a dropdown of exactly these values. */
  options?: string[];
  /** Shown as a cell comment-style note in the guidance row. */
  help?: string;
  width?: number;
};

/**
 * One sheet: a header row, optional guidance row, then the data.
 *
 * The guidance row is a real row rather than cell comments, because comments
 * are invisible until hovered and the person reading this has a receipt in one
 * hand. It is row 2 and the import skips it, which is the one thing the reader
 * has to know about this format.
 */
export function buildWorkbook(
  columns: SheetColumn[],
  rows: Record<string, unknown>[],
  options: { sheetName?: string; guidance?: boolean } = {},
): Blob {
  const sheetName = (options.sheetName ?? "Sheet1").slice(0, 31);
  const guidance = options.guidance !== false;
  const headerRows = guidance ? 2 : 1;

  const cell = (col: number, row: number, value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (text === "") return "";
    // Inline strings throughout: a shared-string table is smaller and is one
    // more part to keep consistent, and these sheets are hundreds of rows.
    return `<c r="${columnName(col)}${row}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  };

  const xmlRows: string[] = [];
  xmlRows.push(
    `<row r="1">${columns.map((c, i) => cell(i, 1, c.header)).join("")}</row>`,
  );
  if (guidance) {
    xmlRows.push(
      `<row r="2">${columns
        .map((c, i) => cell(i, 2, c.help ?? (c.options ? `Pick one: ${c.options.join(", ")}` : "")))
        .join("")}</row>`,
    );
  }
  rows.forEach((row, r) => {
    const n = r + headerRows + 1;
    xmlRows.push(
      `<row r="${n}">${columns.map((c, i) => cell(i, n, row[c.header])).join("")}</row>`,
    );
  });

  // Dropdowns, applied down the column from the first data row. 2000 rows is
  // well past the largest sheet anybody hands out and costs nothing empty.
  const lastRow = headerRows + Math.max(rows.length, 2000);
  const validations = columns
    .map((c, i) => {
      if (!c.options?.length) return "";
      const list = esc(c.options.join(","));
      const ref = `${columnName(i)}${headerRows + 1}:${columnName(i)}${lastRow}`;
      return (
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ` +
        `errorTitle="Not one of the choices" ` +
        `error="Pick one of: ${list}" sqref="${ref}">` +
        `<formula1>"${list}"</formula1></dataValidation>`
      );
    })
    .filter(Boolean);

  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 22}" customWidth="1"/>`)
    .join("");

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${xmlRows.join("")}</sheetData>` +
    (validations.length
      ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`
      : "") +
    `</worksheet>`;

  return zip([
    {
      name: "[Content_Types].xml",
      bytes: bytes(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      bytes: bytes(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      bytes: bytes(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: bytes(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", bytes: bytes(sheetXml) },
  ]);
}

/** Hand the workbook to the browser. */
export function downloadWorkbook(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------------------- reading */

/**
 * Is this a workbook, whatever it happens to be called?
 *
 * Read from the first four bytes rather than the extension. A file arrives
 * renamed, or saved without an extension, or handed over by something that
 * strips it, and deciding by name means a workbook gets parsed as text: the
 * reader finds one unreadable header and reports that none of the columns are
 * recognised, which sends somebody looking at their column names for a fault
 * that is not there.
 *
 * PK is the local file header every ZIP starts with, and an xlsx is a
 * ZIP.
 */
export async function looksLikeWorkbook(file: Blob): Promise<boolean> {
  if (file.size < 4) return false;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** Whether this browser can open the workbooks this module writes. */
export function canReadWorkbooks(): boolean {
  return typeof DecompressionStream !== "undefined";
}

/**
 * Read back an .xlsx, including one Excel wrote.
 *
 * Excel deflates its entries, so reading needs inflate where writing did not.
 * `DecompressionStream("deflate-raw")` is in the browser already, which is what
 * makes this possible without a library at all.
 *
 * Returns the same shape `parseCsv` does, so everything downstream - the
 * mapping, the validator, the exceptions - is unchanged. A second parser that
 * produced a different shape would be a second import.
 */
export async function parseWorkbook(
  file: Blob,
): Promise<{ headers: string[]; rows: Record<string, string>[]; warnings: string[] }> {
  if (!canReadWorkbooks()) {
    throw new Error(
      "This browser cannot open .xlsx files. Save the sheet as CSV from your " +
        "spreadsheet program and upload that instead.",
    );
  }

  const buffer = new Uint8Array(await file.arrayBuffer()) as Bytes;
  const parts = await unzip(buffer);
  const sheet = firstSheet(parts);
  if (!sheet) {
    throw new Error(
      "That workbook has no first sheet where one is expected. Re-download the " +
        "sheet from Partner Records and fill that in.",
    );
  }
  const shared = parts.get("xl/sharedStrings.xml");

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(sheet), "application/xml");
  const strings = shared
    ? [...new DOMParser()
        .parseFromString(new TextDecoder().decode(shared), "application/xml")
        .getElementsByTagName("si")].map((si) =>
          [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""),
        )
    : [];

  const grid: string[][] = [];
  for (const row of [...doc.getElementsByTagName("row")]) {
    const cells: string[] = [];
    for (const c of [...row.getElementsByTagName("c")]) {
      const ref = c.getAttribute("r") ?? "";
      const col = colIndex(ref);
      const type = c.getAttribute("t");
      let value = "";
      if (type === "inlineStr") {
        value = [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
      } else if (type === "s") {
        const i = Number(c.getElementsByTagName("v")[0]?.textContent ?? "-1");
        value = strings[i] ?? "";
      } else {
        value = c.getElementsByTagName("v")[0]?.textContent ?? "";
      }
      cells[col] = value.trim();
    }
    grid.push(cells);
  }

  if (grid.length === 0) throw new Error("That workbook is empty.");
  const headers = (grid[0] ?? []).map((h) => (h ?? "").trim());
  const warnings: string[] = [];

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const record: Record<string, string> = {};
    let filled = 0;
    headers.forEach((h, j) => {
      if (!h) return;
      const v = cells[j] ?? "";
      record[h] = v;
      if (v !== "") filled++;
    });
    if (filled === 0) continue;
    rows.push(record);
  }

  // The guidance row is prose under every heading, and it is row 2 of every
  // sheet this module hands out. Left in, it becomes a record claiming a buyer
  // called "As written on the receipt".
  if (rows.length > 0 && looksLikeGuidance(rows[0])) {
    rows.shift();
    warnings.push("The guidance row was skipped.");
  }

  if (rows.length === 0) {
    throw new Error("That workbook has headings and no rows filled in.");
  }
  return { headers: headers.filter(Boolean), rows, warnings };
}

/** Row two of a sheet this module wrote: prose, and never a stove ID. */
/**
 * The first worksheet, found the way the format says to find it.
 *
 * This used to open `xl/worksheets/sheet1.xml` by name, which is what THIS
 * module writes - and the whole point of the sheet is that somebody opens it
 * in a spreadsheet program and saves it again. Google Sheets, LibreOffice and
 * Excel all rewrite the package on save, and a workbook whose first sheet is
 * not literally sheet1.xml was refused with "no first sheet where one is
 * expected": a confusing rejection of a perfectly good file.
 *
 * So: read the workbook part for the first sheet in tab order, resolve its
 * relationship id to a path, and only then fall back - first to the old
 * filename, then to any worksheet in the package. Three ways to be right,
 * because failing here means the digitiser's whole morning bounces.
 */
function firstSheet(parts: Map<string, Bytes>): Bytes | undefined {
  const text = (name: string) => {
    const part = parts.get(name);
    return part ? new TextDecoder().decode(part) : null;
  };

  const workbook = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    // Tab order is document order in <sheets>, so the first match is the one
    // a person sees first when they open the file.
    const sheetTag = workbook.match(/<sheet\b[^>]*\/?>/i)?.[0] ?? "";
    const relId = sheetTag.match(/r:id\s*=\s*"([^"]+)"/i)?.[1];
    if (relId) {
      const rel = rels.match(
        new RegExp(`<Relationship\\b[^>]*Id\\s*=\\s*"${relId}"[^>]*>`, "i"),
      )?.[0];
      const target = rel?.match(/Target\s*=\s*"([^"]+)"/i)?.[1];
      if (target) {
        // Targets are relative to xl/ and may or may not be written with a
        // leading slash or a ./ prefix, depending on which program saved it.
        const path = target.replace(/^\/?(xl\/)?\.?\/?/, "");
        const found = parts.get(`xl/${path}`) ?? parts.get(path);
        if (found) return found;
      }
    }
  }

  const byName = parts.get("xl/worksheets/sheet1.xml");
  if (byName) return byName;

  for (const [name, bytes] of parts) {
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) return bytes;
  }
  return undefined;
}

function looksLikeGuidance(row: Record<string, string>): boolean {
  const serial = row["Stove ID"] ?? row["Stove Serial Number"] ?? "";
  if (serial) return false;
  const values = Object.values(row).filter(Boolean);
  if (values.length === 0) return false;
  return values.some((v) => /^Pick one:|receipt|spreadsheet|Digits only|Leave empty/i.test(v));
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/** Enough of the ZIP format to find the parts an xlsx keeps its data in. */
async function unzip(buf: Bytes): Promise<Map<string, Bytes>> {
  const out = new Map<string, Bytes>();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Walk the central directory rather than the local headers: a local header
  // may say the sizes are in a trailing descriptor, and the central one never
  // does.
  let end = buf.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("That file is not a workbook.");

  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed) as Bytes;

    if (name.endsWith(".xml")) {
      out.set(
        name,
        method === 0
          ? raw
          : (new Uint8Array(
            await new Response(
              new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
            ).arrayBuffer(),
          ) as Bytes),
      );
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

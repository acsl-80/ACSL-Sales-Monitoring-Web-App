// Generates the downloadable "End User Records API" reference PDF.
//
// This is the document handed to external integrators, so it is built from the
// same PARAMS / FIELDS arrays the on-screen page renders — the two can never
// drift apart. The API key is deliberately NEVER written into the PDF; the
// document is meant to be emailed around, the key is not.

import type jsPDFType from "jspdf";

export interface ParamDef {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface FieldDef {
  name: string;
  description: string;
}

interface BuildArgs {
  endpointUrl: string;
  params: ParamDef[];
  fields: FieldDef[];
  sampleResponse?: string;
}

const BRAND: [number, number, number] = [74, 93, 15]; // #4a5d0f
const MUTED: [number, number, number] = [90, 90, 90];

const MARGIN = 14;

export async function downloadApiDocsPdf({
  endpointUrl,
  params,
  fields,
  sampleResponse,
}: BuildArgs): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc: jsPDFType = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  let y = MARGIN;

  const heading = (text: string, size = 12) => {
    y = ensureSpace(doc, y, 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...BRAND);
    doc.text(text, MARGIN, y);
    y += size === 12 ? 6 : 8;
    doc.setTextColor(0, 0, 0);
  };

  const paragraph = (text: string, size = 9) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    for (const line of lines) {
      y = ensureSpace(doc, y, 6);
      doc.text(line, MARGIN, y);
      y += 4.6;
    }
    doc.setTextColor(0, 0, 0);
    y += 2;
  };

  const codeBlock = (text: string) => {
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(text, contentWidth - 6) as string[];
    const boxHeight = lines.length * 4 + 6;
    y = ensureSpace(doc, y, boxHeight + 4);
    doc.setFillColor(246, 246, 244);
    doc.setDrawColor(220, 220, 216);
    doc.rect(MARGIN, y - 4, contentWidth, boxHeight, "FD");
    let ly = y;
    for (const line of lines) {
      doc.text(line, MARGIN + 3, ly);
      ly += 4;
    }
    y = ly + 4;
    doc.setFont("helvetica", "normal");
  };

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("End User Records API", MARGIN, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("ACSL Sales Monitoring — integration reference", MARGIN, 19);
  doc.setTextColor(0, 0, 0);
  y = 36;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, MARGIN, y);
  doc.setTextColor(0, 0, 0);
  y += 8;

  // ── Endpoint ─────────────────────────────────────────────────────────────
  heading("Endpoint");
  paragraph(
    "Returns a paginated list of end user records. Filters may be supplied as query parameters (GET) or as a JSON body (POST). Both methods are equivalent.",
  );
  codeBlock(`GET  ${endpointUrl}\nPOST ${endpointUrl}`);

  // ── Authentication ───────────────────────────────────────────────────────
  heading("Authentication");
  paragraph(
    "Every request must carry a static bearer API key, issued separately. There is no login call and no token exchange — the key is sent directly on each request. Keep it server-side; never ship it in browser code.",
  );
  codeBlock(
    "Authorization: Bearer <YOUR_API_KEY>\n\n# or, equivalently:\nx-api-key: <YOUR_API_KEY>",
  );
  paragraph(
    "Requests with a missing or incorrect key are rejected with 401. The key is not included in this document — request it through your usual contact.",
  );

  // ── Synchronisation gate ─────────────────────────────────────────────────
  heading("Which records are ready to synchronise");
  paragraph(
    "Each record carries a boolean is_ready_to_sync. It is true when the sale is complete (status = completed) and not cancelled. A record is complete once every field the sales form requires is present, including a customer signature; the value is recalculated whenever a sale is created or edited, so a record corrected later becomes ready automatically.",
  );
  paragraph(
    "To pull only records that are ready, filter server-side with status=completed. Records still awaiting verification carry status pending (no valid signature) or incomplete (a required field missing).",
  );
  codeBlock(`GET ${endpointUrl}?status=completed&limit=500`);

  // ── Incremental sync ─────────────────────────────────────────────────────
  heading("Incremental synchronisation");
  paragraph(
    "Use updatedSince with the timestamp of your last successful run to fetch only what has changed. This catches records edited or newly completed since that point, which a sales-date range would miss. Results are ordered by sales_date descending, with id as a tiebreaker so pagination stays stable while you page through a large set.",
  );
  codeBlock(
    `GET ${endpointUrl}?status=completed&updatedSince=2026-07-01T00:00:00Z&page=1&limit=500`,
  );

  // ── Parameters ───────────────────────────────────────────────────────────
  heading("Request parameters");
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Name", "Type", "Required", "Default", "Description"]],
    body: params.map((p) => [
      p.name,
      p.type,
      p.required ? "yes" : "no",
      p.default || "—",
      p.description,
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.8, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 26, font: "courier" },
      1: { cellWidth: 26 },
      2: { cellWidth: 15 },
      3: { cellWidth: 14 },
      4: { cellWidth: "auto" },
    },
  });
  y = currentY(doc) + 8;

  // ── Response shape ───────────────────────────────────────────────────────
  heading("Response shape");
  codeBlock(
    `{
  "success": true,
  "pagination": { "page": 1, "limit": 100, "total": 0, "totalPages": 0 },
  "data": [ { ... one object per record, fields below ... } ]
}`,
  );
  paragraph('Errors return { "success": false, "error": "<message>" } with a 4xx or 5xx status.');

  // ── Fields ───────────────────────────────────────────────────────────────
  heading("Response fields");
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Field", "Description"]],
    body: fields.map((f) => [f.name, f.description]),
    styles: { fontSize: 7.5, cellPadding: 1.8, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 52, font: "courier" },
      1: { cellWidth: "auto" },
    },
  });
  y = currentY(doc) + 8;

  // ── Sample response ──────────────────────────────────────────────────────
  if (sampleResponse) {
    doc.addPage();
    y = MARGIN;
    heading("Example response");
    paragraph("Live sample taken from the API at the time this document was generated.");
    const truncated =
      sampleResponse.length > 6000
        ? `${sampleResponse.slice(0, 6000)}\n\n… truncated …`
        : sampleResponse;
    codeBlock(truncated);
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      "ACSL Sales Monitoring — End User Records API",
      MARGIN,
      doc.internal.pageSize.getHeight() - 8,
    );
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - MARGIN,
      doc.internal.pageSize.getHeight() - 8,
      { align: "right" },
    );
  }

  doc.save(`end-user-records-api-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Adds a page when `needed` mm would overflow, returning the y to carry on at. */
function ensureSpace(doc: jsPDFType, y: number, needed: number): number {
  const limit = doc.internal.pageSize.getHeight() - 16;
  if (y + needed > limit) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** autoTable stores its end position on the doc; typings don't cover it. */
function currentY(doc: jsPDFType): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? MARGIN;
}

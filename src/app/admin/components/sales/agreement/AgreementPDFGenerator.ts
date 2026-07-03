import jsPDF from "jspdf";

// Pixel-faithful replica of the atmosfair "Improved Cook Stoves Programme for
// Nigeria — User Agreement / Receipt" paper form, generated in code from a sale
// record. The on-screen "View Agreement" / download produces this document.

const GRAY: [number, number, number] = [210, 214, 220]; // N/A shaded cells
const GREEN: [number, number, number] = [120, 170, 40]; // atmosfair wordmark
const DARKGREEN: [number, number, number] = [60, 110, 20];
// Brand blues (matches tailwind brand: #07376a / header #194977 / light #EFF6FF)
const BLUE: [number, number, number] = [7, 55, 106]; // section bars
const BLUE_HEADER: [number, number, number] = [25, 73, 119]; // table header
const BLUE_LIGHT: [number, number, number] = [232, 240, 250]; // label cells
const BORDER: [number, number, number] = [120, 140, 165]; // muted blue grid lines

const formatDate = (dateStr?: string) => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatAmount = (amount?: number | null) => {
  if (amount === undefined || amount === null) return "";
  return Number(amount).toLocaleString("en-NG");
};

const resolveAddress = (sale: any) => sale?.address || sale?.addresses || null;

// Split a single full name into [surname, firstName(s)] — first token is taken
// as the surname (common ordering on these Nigerian field forms).
const splitName = (name?: string): [string, string] => {
  if (!name) return ["", ""];
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], ""];
  return [parts[0], parts.slice(1).join(" ")];
};

const tryLoadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });

export const generateAgreementPDF = async (sale: any): Promise<jsPDF> => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ── Layout constants ───────────────────────────────────────────────────────
  const L = 8; // left margin
  const R = 202; // right edge
  const W = R - L; // content width
  // person-table column boundaries
  const cLabel = L;
  const cUser = 56;
  const cBuyer = 152;

  doc.setLineWidth(0.3);
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); // muted blue grid lines

  const fillRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: [number, number, number]
  ) => {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y, w, h, "F");
  };

  const box = (x: number, y: number, w: number, h: number) =>
    doc.rect(x, y, w, h);

  const checkbox = (x: number, y: number, checked: boolean, size = 3.4) => {
    doc.setLineWidth(0.3);
    doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.rect(x, y, size, size);
    if (checked) {
      doc.setLineWidth(0.7);
      doc.line(x + 0.7, y + size * 0.55, x + size * 0.4, y + size - 0.6);
      doc.line(x + size * 0.4, y + size - 0.6, x + size - 0.3, y + 0.5);
      doc.setLineWidth(0.3);
    }
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  };

  // ── Gather data ────────────────────────────────────────────────────────────
  const address = resolveAddress(sale);
  const [userSurname, userFirst] = splitName(sale?.end_user_name);
  const [buyerSurname, buyerFirst] = splitName(sale?.contact_person);
  const buyerIsUser =
    !sale?.contact_person ||
    sale?.contact_person?.trim() === sale?.end_user_name?.trim();
  const terms = sale?.terms_accepted || {};
  const isCredit = sale?.is_installment === true;
  const potQty = Number(sale?.pot_quantity ?? -1);
  const creatorName =
    sale?.creator?.full_name || sale?.agent_name || "";

  let y = 8;

  // ── Header: logos + title ──────────────────────────────────────────────────
  const headerH = 20;
  // atmosfair logo (left) — real asset from /logo.png, aspect ~3:1
  const atmosLogo = await tryLoadImage("/logo.png");
  if (atmosLogo) {
    try {
      doc.addImage(atmosLogo, "PNG", L, y + 2, 45, 15);
    } catch {
      /* ignore */
    }
  } else {
    // fallback wordmark if the asset fails to load
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(DARKGREEN[0], DARKGREEN[1], DARKGREEN[2]);
    doc.text("atmosfair", L, y + 12);
    doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
    doc.setLineWidth(1);
    doc.line(L, y + 14, L + 40, y + 14);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
  }

  // Title (center)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(60, 70, 85);
  doc.text("Improved Cook Stoves Programme for Nigeria", 105, y + 4, {
    align: "center",
  });
  doc.setFontSize(18);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text("User Agreement / Receipt", 105, y + 13, { align: "center" });

  // Save 80 logo (right) — real asset from /save80.png, aspect ~2.07:1
  const save80Logo = await tryLoadImage("/save80.png");
  if (save80Logo) {
    try {
      const sw = 33;
      const sh = sw / 2.07;
      doc.addImage(save80Logo, "PNG", R - sw, y + 2, sw, sh);
    } catch {
      /* ignore */
    }
  }
  doc.setTextColor(0, 0, 0);

  y += headerH;

  // ── Contact bar ────────────────────────────────────────────────────────────
  const barH = 7;
  fillRect(L, y, W, barH, BLUE_LIGHT);
  box(L, y, W, barH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text(
    "No. 22, Ja'Afaru Mai Malari Road, Bompai Industrial Area, Kano - Nigeria  |  Tel: 09120135750, 09120135754, 08121726360",
    105,
    y + 4.6,
    { align: "center" }
  );
  doc.setTextColor(0, 0, 0);
  y += barH;

  // ── People table header row ────────────────────────────────────────────────
  const thH = 9;
  // diagonal corner cell
  fillRect(cLabel, y, cUser - cLabel, thH, BLUE_HEADER);
  box(cLabel, y, cUser - cLabel, thH);
  doc.setDrawColor(255, 255, 255);
  doc.line(cLabel, y, cUser, y + thH); // diagonal
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  // User details
  fillRect(cUser, y, cBuyer - cUser, thH, BLUE_HEADER);
  box(cUser, y, cBuyer - cUser, thH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text("User details", cUser + 2, y + 5.5);
  // Buyer details
  fillRect(cBuyer, y, R - cBuyer, thH, BLUE_HEADER);
  box(cBuyer, y, R - cBuyer, thH);
  doc.setFontSize(8);
  doc.text("Buyer details: (if", cBuyer + 2, y + 4);
  doc.text("not user)", cBuyer + 2, y + 7.5);
  doc.setTextColor(0, 0, 0);
  y += thH;

  // Helper to render a standard person row
  const personRow = (
    label: string,
    userVal: string,
    buyerVal: string | "N/A",
    h = 7
  ) => {
    // label cell (light blue)
    fillRect(cLabel, y, cUser - cLabel, h, BLUE_LIGHT);
    box(cLabel, y, cUser - cLabel, h);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
    const labelLines = doc.splitTextToSize(label, cUser - cLabel - 3);
    doc.text(labelLines, cLabel + 1.5, y + h / 2 - (labelLines.length - 1) * 1.5 + 1);
    doc.setTextColor(0, 0, 0);
    // user cell (white)
    box(cUser, y, cBuyer - cUser, h);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    if (userVal) doc.text(userVal, cUser + 2, y + h / 2 + 1.2);
    // buyer cell
    if (buyerVal === "N/A") {
      fillRect(cBuyer, y, R - cBuyer, h, GRAY);
      box(cBuyer, y, R - cBuyer, h);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("N/A", (cBuyer + R) / 2, y + h / 2 + 1.2, { align: "center" });
    } else {
      box(cBuyer, y, R - cBuyer, h);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      if (buyerVal) doc.text(buyerVal, cBuyer + 2, y + h / 2 + 1.2);
    }
    y += h;
  };

  const buyerCell = (v: string) => (buyerIsUser ? "" : v);

  personRow("SURNAME", userSurname, buyerCell(buyerSurname));
  personRow("FIRST NAME", userFirst, buyerCell(buyerFirst));

  // RESIDENTIAL ADDRESS — tall, buyer side is 3 stacked N/A cells
  {
    const h = 16;
    fillRect(cLabel, y, cUser - cLabel, h, BLUE_LIGHT);
    box(cLabel, y, cUser - cLabel, h);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.text("RESIDENTIAL ADDRESS", cLabel + 1.5, y + h / 2 + 1);
    doc.setTextColor(0, 0, 0);
    box(cUser, y, cBuyer - cUser, h);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const addr = address?.full_address || address?.street || "";
    if (addr) {
      const lines = doc.splitTextToSize(addr, cBuyer - cUser - 4);
      doc.text(lines.slice(0, 3), cUser + 2, y + 5);
    }
    // buyer: three N/A sub-cells
    const sub = h / 3;
    for (let i = 0; i < 3; i++) {
      fillRect(cBuyer, y + i * sub, R - cBuyer, sub, GRAY);
      box(cBuyer, y + i * sub, R - cBuyer, sub);
      doc.text("N/A", (cBuyer + R) / 2, y + i * sub + sub / 2 + 1.2, {
        align: "center",
      });
    }
    y += h;
  }

  personRow("LGA", sale?.lga_backup || "", "N/A");
  personRow("STATE", sale?.state_backup || "", "N/A");
  personRow("TELEPHONE NUMBER", sale?.phone || "", buyerCell(sale?.contact_phone || ""));
  personRow("OTHER TELEPHONE NUMBER", sale?.other_phone || "", "");
  personRow("SALES PARTNER", sale?.partner_name || "", "N/A");
  personRow("RETAILER / SALES BRANCH / AGENCY / CSO", sale?.retailer_branch || "", "N/A", 9);

  // ── STOVE SET AND PAYMENT OPTION bar ───────────────────────────────────────
  fillRect(L, y, W, 6, BLUE);
  box(L, y, W, 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text("STOVE SET AND PAYMENT OPTION", L + 1.5, y + 4.2);
  doc.setTextColor(0, 0, 0);
  y += 6;

  // stove set row — 4 columns
  {
    const h = 24;
    const c1 = L;
    const c2 = L + 62;
    const c3 = L + 112;
    const c4 = R - 42;
    box(c1, y, c2 - c1, h);
    box(c2, y, c3 - c2, h);
    box(c3, y, c4 - c3, h);
    box(c4, y, R - c4, h);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    // col1 Stove type
    doc.text("Stove type:", c1 + 2, y + 6);
    doc.text("Save80", c1 + 2, y + 13);
    doc.line(c1 + 18, y + 12.5, c2 - 8, y + 12.5);
    checkbox(c2 - 6, y + 10.5, true);
    // col2 pots
    doc.text("Pots quantity:", c2 + 2, y + 6);
    const pots = ["0 pots", "1 pot", "2 pots"];
    pots.forEach((p, i) => {
      const py = y + 11 + i * 5;
      doc.text(p, c2 + 2, py + 0.5);
      doc.line(c2 + 14, py, c3 - 8, py);
      checkbox(c3 - 6, py - 2.6, potQty === i, 3.2);
    });
    // col3 heat retention
    doc.text("Heat retention device", c3 + 2, y + 7);
    doc.text("Wonderbox", c3 + 2, y + 14);
    doc.line(c3 + 24, y + 13.5, c4 - 8, y + 13.5);
    checkbox(c4 - 6, y + 11.5, !!sale?.heat_retention_device);
    // col4 cash/credit
    doc.text("CASH", c4 + 2, y + 6);
    doc.text("PURCHASE", c4 + 2, y + 10);
    checkbox(R - 6, y + 6.5, !isCredit);
    doc.text("CREDIT", c4 + 2, y + 17);
    doc.text("PURCHASE", c4 + 2, y + 21);
    checkbox(R - 6, y + 17.5, isCredit);
    y += h;
  }

  // ── Sales date / serial / amount ───────────────────────────────────────────
  {
    const hH = 9;
    const v = 15;
    const a1 = L;
    const a2 = L + 70;
    const a3 = R - 50;
    // header labels (light-blue tint)
    fillRect(a1, y, a2 - a1, hH, BLUE_LIGHT);
    fillRect(a2, y, a3 - a2, hH, BLUE_LIGHT);
    fillRect(a3, y, R - a3, hH, BLUE_LIGHT);
    box(a1, y, a2 - a1, hH);
    box(a2, y, a3 - a2, hH);
    box(a3, y, R - a3, hH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.text("SALES DATE", a1 + 2, y + 5.4);
    doc.text("STOVE SERIAL NUMBER", a2 + 2, y + 5.4);
    doc.text("AMOUNT PAID", a3 + 2, y + 4);
    doc.setFontSize(6.5);
    doc.text("(Naira)", a3 + 2, y + 7.2);
    doc.setTextColor(0, 0, 0);
    y += hH;
    // value cells
    box(a1, y, a2 - a1, v);
    box(a2, y, a3 - a2, v);
    box(a3, y, R - a3, v);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(formatDate(sale?.sales_date), a1 + 2, y + 8);
    doc.text(String(sale?.stove_serial_no || ""), a2 + 2, y + 8);
    doc.text(formatAmount(sale?.amount), a3 + 2, y + 8);
    y += v;
  }

  // ── Terms and conditions ───────────────────────────────────────────────────
  y += 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text("TERMS AND CONDITIONS: (please tick)", L, y + 3);
  doc.setTextColor(0, 0, 0);
  y += 5;

  const termList: { key: string; text: string }[] = [
    {
      key: "poaGoverned",
      text: "This stove is promoted and sold under the atmosfair Programme of Activities (PoA) which is governed by the UN Framework Convention on Climate Change (UNFCCC) and Gold Standard for the Global Goals. I hereby recognize that the stove is subsidized by Carbon Credits.",
    },
    {
      key: "monitoring",
      text: "I agree to cooperate with the distributor and the cooperating managing entity (atmosfair gGmbH) for monitoring purposes.",
    },
    { key: "noResell", text: "I agree not to resell the stove." },
    {
      key: "emissionReductions",
      text: "I agree not to claim any emission reductions for the use of the efficient cook stove but cede the emission reductions the stove generates to the cooperating managing entity (atmosfair gGmbH) of the Programme of Activities (PoA).",
    },
    { key: "noExport", text: "I agree not to take the stove outside of Nigeria." },
    {
      key: "demonstration",
      text: "I have received a sufficient demonstration and explanation for efficient firewood stove usage.",
    },
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  termList.forEach(({ key, text }) => {
    checkbox(L + 4, y, !!terms[key], 3.2);
    const lines = doc.splitTextToSize(text, W - 12);
    doc.text(lines, L + 9, y + 3);
    y += Math.max(lines.length * 3.7, 4) + 1.5;
  });

  // ── Predominant previous stove ─────────────────────────────────────────────
  y += 1;
  const prevBoxTop = y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const intro = doc.splitTextToSize(
    "The new Save80 user was predominantly using the following stove (the stove they were cooking most of the meals with):",
    W - 4
  );
  doc.text(intro, L + 2, y + 4);
  y += intro.length * 3.7 + 3;
  // three columns
  const pCol = W / 3;
  const prevType = sale?.previous_stove_type;
  const colTop = y;
  const colH = 14;
  for (let i = 0; i < 3; i++) box(L + i * pCol, colTop, pCol, colH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  checkbox(L + 2, colTop + 2, prevType === "charcoal", 3.2);
  doc.text("Charcoal stove", L + 7, colTop + 4.5);
  checkbox(L + pCol + 2, colTop + 2, prevType === "wood_stove", 3.2);
  doc.text("Wood Stove", L + pCol + 7, colTop + 4.5);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("(3 stone or similar)", L + pCol + 7, colTop + 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  checkbox(L + 2 * pCol + 2, colTop + 2, prevType === "other", 3.2);
  doc.text("Other", L + 2 * pCol + 7, colTop + 4.5);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("(please specify)", L + 2 * pCol + 7, colTop + 8);
  if (prevType === "other" && sale?.previous_stove_other) {
    doc.setFontSize(7.5);
    doc.text(
      doc.splitTextToSize(String(sale.previous_stove_other), pCol - 8),
      L + 2 * pCol + 2,
      colTop + 11.5
    );
  }
  // outer border around predominant section
  box(L, prevBoxTop, W, colTop + colH - prevBoxTop);
  y = colTop + colH;

  // ── Meal/fuel/location questions ───────────────────────────────────────────
  const qH = 6;
  const qRows: [string, string][] = [
    ["How many meals do you prepare usually on your stove?", sale?.meals_per_day || ""],
    ["Where do you get your cooking fuel from?", sale?.cooking_fuel_source || ""],
    ["Where do you cook usually?", sale?.cooking_location || ""],
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  qRows.forEach(([q, val]) => {
    box(L, y, W, qH);
    doc.text(q, L + 2, y + 4);
    if (val) doc.text(String(val), L + 95, y + 4);
    y += qH;
  });

  // ── Signature + agent name ─────────────────────────────────────────────────
  {
    const h = 18;
    const half = W / 2;
    fillRect(L, y, W, h, BLUE_LIGHT);
    box(L, y, half, h);
    box(L + half, y, half, h);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.text("BUYER'S SIGNATURE:", L + 2, y + 4);
    doc.text("SALES AGENT'S NAME:", L + half + 2, y + 4);
    doc.setTextColor(0, 0, 0);
    // signature image
    if (sale?.signature) {
      const sig = await tryLoadImage(`data:image/png;base64,${sale.signature}`);
      if (sig) {
        try {
          doc.addImage(sig, "PNG", L + 4, y + 5, 50, 11);
        } catch {
          /* ignore */
        }
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (creatorName) doc.text(String(creatorName), L + half + 4, y + 12);
    y += h;
  }

  return doc;
};

// Returns an object URL for viewing the agreement in an iframe.
export const buildAgreementBlobUrl = async (sale: any): Promise<string> => {
  const doc = await generateAgreementPDF(sale);
  return doc.output("bloburl") as unknown as string;
};

// Triggers a direct download of the agreement PDF.
export const downloadAgreementPDF = async (sale: any): Promise<void> => {
  const doc = await generateAgreementPDF(sale);
  doc.save(`Agreement_${sale?.transaction_id || sale?.id || "sale"}.pdf`);
};

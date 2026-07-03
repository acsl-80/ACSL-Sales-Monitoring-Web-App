// PDF generation utilities for receipts and invoices
// You'll need to install: npm install jspdf jspdf-autotable

export const generateReceiptPDF = (saleData) => {
  // Dynamic import to avoid SSR issues
  return import("jspdf").then(({ default: jsPDF }) => {
    const doc = new jsPDF();

    // Company Header
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("ATMOSFAIR", 20, 30);

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Clean Cooking Solutions", 20, 40);
    doc.text("Receipt", 20, 55);

    // Receipt Details
    const receiptNumber = `RCP-${saleData.transaction_id || saleData.id}`;
    const currentDate = new Date().toLocaleDateString();

    doc.setFontSize(10);
    doc.text(`Receipt #: ${receiptNumber}`, 120, 30);
    doc.text(`Date: ${currentDate}`, 120, 40);
    doc.text(
      `Transaction ID: ${saleData.transaction_id || saleData.id}`,
      120,
      50
    );

    // Customer Information
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Customer Information", 20, 75);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const customerName =
      saleData.end_user_name || saleData.contact_person || "N/A";
    const customerPhone = saleData.phone || saleData.contact_phone || "N/A";
    const customerEmail = saleData.email || saleData.contact_email || "N/A";

    doc.text(`Name: ${customerName}`, 20, 85);
    doc.text(`Phone: ${customerPhone}`, 20, 95);
    doc.text(`Email: ${customerEmail}`, 20, 105);

    // Address
    const address =
      saleData.addresses?.full_address ||
      saleData.address?.full_address ||
      `${
        saleData.lga_backup ||
        saleData.addresses?.city ||
        saleData.address?.city ||
        ""
      } ${
        saleData.state_backup ||
        saleData.addresses?.state ||
        saleData.address?.state ||
        ""
      }`.trim() ||
      "N/A";
    doc.text(`Address: ${address}`, 20, 115);

    // Product Information
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Product Information", 20, 135);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Product: Atmosfair Stove`, 20, 145);
    doc.text(`Serial Number: ${saleData.stove_serial_no || "N/A"}`, 20, 155);
    doc.text(
      `Partner: ${saleData.partner_name || saleData.partner || "N/A"}`,
      20,
      165
    );

    // Payment Information
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Payment Information", 20, 185);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const amount = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(saleData.amount || 0);

    doc.text(`Amount: ${amount}`, 20, 195);
    doc.text(`Payment Method: ${saleData.payment_method || "Cash"}`, 20, 205);
    doc.text(
      `Payment Status: ${
        saleData.payment_status || saleData.status || "Completed"
      }`,
      20,
      215
    );
    doc.text(
      `Sale Date: ${new Date(
        saleData.sales_date || saleData.created_at
      ).toLocaleDateString()}`,
      20,
      225
    );

    // Footer
    doc.setFontSize(8);
    doc.text(
      "Thank you for choosing Atmosfair Clean Cooking Solutions!",
      20,
      260
    );
    doc.text("For support, contact: support@atmosfair.org", 20, 270);

    return doc;
  });
};

export const generateInvoicePDF = (saleData) => {
  return import("jspdf").then(({ default: jsPDF }) => {
    return import("jspdf-autotable").then(() => {
      const doc = new jsPDF();

      // Company Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("ATMOSFAIR", 20, 30);

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text("Clean Cooking Solutions", 20, 40);

      // Invoice Title
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("INVOICE", 150, 30);

      // Invoice Details
      const invoiceNumber = `INV-${saleData.transaction_id || saleData.id}`;
      const currentDate = new Date().toLocaleDateString();
      const dueDate = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toLocaleDateString(); // 30 days from now

      doc.setFontSize(10);
      doc.text(`Invoice #: ${invoiceNumber}`, 120, 45);
      doc.text(`Date: ${currentDate}`, 120, 55);
      doc.text(`Due Date: ${dueDate}`, 120, 65);

      // Bill To
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Bill To:", 20, 80);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const customerName =
        saleData.end_user_name || saleData.contact_person || "N/A";
      const customerPhone = saleData.phone || saleData.contact_phone || "N/A";
      const customerEmail = saleData.email || saleData.contact_email || "N/A";
      const address =
        saleData.addresses?.full_address ||
        saleData.address?.full_address ||
        `${
          saleData.lga_backup ||
          saleData.addresses?.city ||
          saleData.address?.city ||
          ""
        } ${
          saleData.state_backup ||
          saleData.addresses?.state ||
          saleData.address?.state ||
          ""
        }`.trim() ||
        "N/A";

      doc.text(customerName, 20, 90);
      doc.text(address, 20, 100);
      doc.text(`Phone: ${customerPhone}`, 20, 110);
      doc.text(`Email: ${customerEmail}`, 20, 120);

      // Items Table
      const tableStartY = 140;
      const amount = saleData.amount || 0;
      const tax = amount * 0.075; // 7.5% VAT
      const total = amount + tax;

      const tableData = [
        [
          "1",
          `Atmosfair Stove - ${saleData.stove_serial_no || "N/A"}`,
          "1",
          new Intl.NumberFormat("en-NG", {
            style: "currency",
            currency: "NGN",
          }).format(amount),
          new Intl.NumberFormat("en-NG", {
            style: "currency",
            currency: "NGN",
          }).format(amount),
        ],
      ];

      doc.autoTable({
        head: [["#", "Description", "Qty", "Unit Price", "Total"]],
        body: tableData,
        startY: tableStartY,
        theme: "grid",
        headStyles: { fillColor: [66, 139, 202] },
        styles: { fontSize: 10 },
      });

      // Totals
      const finalY = doc.lastAutoTable.finalY + 20;

      doc.setFontSize(10);
      doc.text("Subtotal:", 120, finalY);
      doc.text(
        new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
        }).format(amount),
        160,
        finalY
      );

      doc.text("VAT (7.5%):", 120, finalY + 10);
      doc.text(
        new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
        }).format(tax),
        160,
        finalY + 10
      );

      doc.setFont("helvetica", "bold");
      doc.text("Total:", 120, finalY + 20);
      doc.text(
        new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
        }).format(total),
        160,
        finalY + 20
      );

      // Payment Terms
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Payment Terms: Net 30 days", 20, finalY + 40);
      doc.text("Thank you for your business!", 20, finalY + 50);

      return doc;
    });
  });
};

// For environments without jsPDF, create a fallback HTML-based approach
export const generateReceiptHTML = (saleData) => {
  const receiptNumber = `RCP-${saleData.transaction_id || saleData.id}`;
  const currentDate = new Date().toLocaleDateString();
  const customerName =
    saleData.end_user_name || saleData.contact_person || "N/A";
  const amount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(saleData.amount || 0);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt - ${receiptNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
        .company-name { font-size: 24px; font-weight: bold; color: #2563eb; }
        .receipt-info { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: bold; font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px; }
        .amount { font-size: 20px; font-weight: bold; color: #059669; }
        .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #666; }
        @media print { button { display: none; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-name">ATMOSFAIR</div>
        <div>Clean Cooking Solutions</div>
        <h2>RECEIPT</h2>
      </div>
      
      <div class="receipt-info">
        <div>
          <strong>Receipt #:</strong> ${receiptNumber}<br>
          <strong>Date:</strong> ${currentDate}
        </div>
        <div>
          <strong>Transaction ID:</strong> ${
            saleData.transaction_id || saleData.id
          }
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">Customer Information</div>
        <strong>Name:</strong> ${customerName}<br>
        <strong>Phone:</strong> ${
          saleData.phone || saleData.contact_phone || "N/A"
        }<br>
        <strong>Email:</strong> ${
          saleData.email || saleData.contact_email || "N/A"
        }
      </div>
      
      <div class="section">
        <div class="section-title">Product Information</div>
        <strong>Product:</strong> Atmosfair Stove<br>
        <strong>Serial Number:</strong> ${saleData.stove_serial_no || "N/A"}
      </div>
      
      <div class="section">
        <div class="section-title">Payment Information</div>
        <div class="amount">Total Amount: ${amount}</div>
        <strong>Payment Method:</strong> ${
          saleData.payment_method || "Cash"
        }<br>
        <strong>Status:</strong> ${
          saleData.payment_status || saleData.status || "Completed"
        }
      </div>
      
      <div class="footer">
        <p>Thank you for choosing Atmosfair Clean Cooking Solutions!</p>
        <button onclick="window.print()">Print Receipt</button>
      </div>
    </body>
    </html>
  `;
};

export const downloadFile = (content, filename, type = "application/pdf") => {
  const blob = new window.Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

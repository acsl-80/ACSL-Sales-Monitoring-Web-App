// Email service for sending receipts and invoices
// You'll need to configure your email service (SendGrid, NodeMailer, etc.)

export const sendReceiptEmail = async (saleData, recipientEmail) => {
  try {
    // This is a template for email sending - you'll need to implement based on your backend
    const emailData = {
      to: recipientEmail,
      subject: `Receipt for your Atmosfair Stove Purchase - ${
        saleData.transaction_id || saleData.id
      }`,
      template: "receipt",
      templateData: {
        customerName:
          saleData.end_user_name ||
          saleData.contact_person ||
          "Valued Customer",
        transactionId: saleData.transaction_id || saleData.id,
        amount: new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
        }).format(saleData.amount || 0),
        stoveSerial: saleData.stove_serial_no || "N/A",
        saleDate: new Date(
          saleData.sales_date || saleData.created_at
        ).toLocaleDateString(),
        paymentMethod: saleData.payment_method || "Cash",
      },
    };

    // NOTE: The original Next.js `/api/send-email` route was a no-op demo (it
    // only logged and returned success; real sending was commented out). On
    // TanStack Start, wire this to a `createServerFn` when a real email
    // provider is configured. For now we preserve the original behavior.
    console.log("Email would be sent:", emailData);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error("Error sending receipt email:", error);
    throw error;
  }
};

export const sendInvoiceEmail = async (saleData, recipientEmail) => {
  try {
    const emailData = {
      to: recipientEmail,
      subject: `Invoice for your Atmosfair Stove Purchase - INV-${
        saleData.transaction_id || saleData.id
      }`,
      template: "invoice",
      templateData: {
        customerName:
          saleData.end_user_name ||
          saleData.contact_person ||
          "Valued Customer",
        invoiceNumber: `INV-${saleData.transaction_id || saleData.id}`,
        transactionId: saleData.transaction_id || saleData.id,
        amount: new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
        }).format(saleData.amount || 0),
        stoveSerial: saleData.stove_serial_no || "N/A",
        saleDate: new Date(
          saleData.sales_date || saleData.created_at
        ).toLocaleDateString(),
        dueDate: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toLocaleDateString(),
      },
    };

    // See note in sendReceiptEmail: original route was a no-op demo.
    console.log("Email would be sent:", emailData);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error("Error sending invoice email:", error);
    throw error;
  }
};

// Fallback email composition for mailto links
export const composeReceiptEmail = (saleData) => {
  const subject = `Receipt for Atmosfair Stove Purchase - ${
    saleData.transaction_id || saleData.id
  }`;
  const body = `
Dear ${saleData.end_user_name || saleData.contact_person || "Customer"},

Thank you for your purchase from Atmosfair Clean Cooking Solutions.

Receipt Details:
- Transaction ID: ${saleData.transaction_id || saleData.id}
- Product: Atmosfair Stove
- Serial Number: ${saleData.stove_serial_no || "N/A"}
- Amount: ${new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(saleData.amount || 0)}
- Payment Method: ${saleData.payment_method || "Cash"}
- Sale Date: ${new Date(
    saleData.sales_date || saleData.created_at
  ).toLocaleDateString()}

We appreciate your business and trust in our clean cooking solutions.

Best regards,
Atmosfair Team
  `.trim();

  return {
    subject: encodeURIComponent(subject),
    body: encodeURIComponent(body),
  };
};

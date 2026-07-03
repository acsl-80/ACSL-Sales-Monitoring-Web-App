import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { SuperAdminSale } from "@/types/superAdminSales";

export interface DownloadReceiptOptions {
  filename?: string;
  quality?: number;
  scale?: number;
}

export const downloadReceiptAsPDF = async (
  sale: SuperAdminSale,
  options: DownloadReceiptOptions = {}
): Promise<void> => {
  const {
    filename = `receipt-${sale.transaction_id || sale.id}-${
      new Date().toISOString().split("T")[0]
    }.pdf`,
    quality = 1,
    scale = 2,
  } = options;

  try {
    // Find the receipt element
    const receiptElement = document.getElementById("receipt-to-download");

    if (!receiptElement) {
      throw new Error("Receipt element not found");
    }

    // Configure html2canvas options
    const canvas = await html2canvas(receiptElement, {
      scale: scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
      height: receiptElement.scrollHeight,
      width: receiptElement.scrollWidth,
    });

    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 295; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;

    // Create PDF
    const pdf = new jsPDF("p", "mm", "a4");
    let position = 0;

    // Add first page
    pdf.addImage(
      canvas.toDataURL("image/png", quality),
      "PNG",
      0,
      position,
      imgWidth,
      imgHeight,
      undefined,
      "FAST"
    );
    heightLeft -= pageHeight;

    // Add additional pages if content is longer than one page
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(
        canvas.toDataURL("image/png", quality),
        "PNG",
        0,
        position,
        imgWidth,
        imgHeight,
        undefined,
        "FAST"
      );
      heightLeft -= pageHeight;
    }

    // Download the PDF
    pdf.save(filename);
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw new Error("Failed to generate PDF. Please try again.");
  }
};

export const useReceiptDownload = () => {
  const downloadReceipt = async (
    sale: SuperAdminSale,
    options?: DownloadReceiptOptions
  ): Promise<void> => {
    try {
      await downloadReceiptAsPDF(sale, options);
    } catch (error) {
      console.error("Download failed:", error);
      throw error;
    }
  };

  return { downloadReceipt };
};

import React, { useState } from "react";
import Modal from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Download, Eye, Loader2 } from "lucide-react";
import Receipt from "./Receipt";
import { useReceiptDownload } from "../utils/receiptDownload";

const ReceiptModal = ({ isOpen, onClose, modalSale }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { downloadReceipt } = useReceiptDownload();

  const handleDownload = async () => {
    if (!modalSale) return;

    setIsDownloading(true);
    try {
      await downloadReceipt(modalSale);
    } catch (error) {
      console.error("Download failed:", error);
      // You can add toast notification here
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePreview = () => {
    setShowPreview(true);
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Receipt Options">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            Receipt for Transaction:{" "}
            {modalSale?.transaction_id || modalSale?.id}
          </h2>

          <div className="flex gap-3">
            <Button
              onClick={handlePreview}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Eye className="h-4 w-4" />
              Preview Receipt
            </Button>

            <Button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-2"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isDownloading ? "Generating..." : "Download PDF"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Preview Modal */}
      {showPreview && modalSale && (
        <Modal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          title="Receipt Preview"
          className="max-w-4xl"
        >
          <div className="max-h-[80vh] overflow-auto">
            <div id="receipt-to-download">
              <Receipt sale={modalSale} />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Close Preview
              </Button>
              <Button
                onClick={handleDownload}
                disabled={isDownloading}
                className="flex items-center gap-2"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isDownloading ? "Generating..." : "Download PDF"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default ReceiptModal;

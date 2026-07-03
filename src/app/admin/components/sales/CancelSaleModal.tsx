import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertTriangle } from "lucide-react";

interface CancelSaleModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  sale: {
    transaction_id?: string | null;
    end_user_name?: string | null;
    stove_serial_no?: string | null;
  } | null;
}

const CancelSaleModal: React.FC<CancelSaleModalProps> = ({
  open,
  onClose,
  onConfirm,
  sale,
}) => {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm(reason.trim());
      setReason("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (submitting) return;
    if (!v) {
      setReason("");
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      size="md"
      title={
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          Cancel Sale
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium mb-1">Please note:</p>
          <ul className="list-disc pl-4 space-y-1 text-red-700">
            <li>This sale will be removed from the Sales Records view.</li>
            <li>
              The stove ID (
              <span className="font-mono">{sale?.stove_serial_no || "N/A"}</span>
              ) will be released and made available for sale again.
            </li>
            <li>
              The transaction will appear under{" "}
              <span className="font-medium">Cancelled Transactions</span>.
            </li>
          </ul>
        </div>

        <div className="text-sm text-gray-700">
          <div>
            <span className="font-medium">Transaction:</span>{" "}
            {sale?.transaction_id || "N/A"}
          </div>
          <div>
            <span className="font-medium">End User:</span>{" "}
            {sale?.end_user_name || "N/A"}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason for cancelling{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Customer changed mind, duplicate entry, wrong stove ID..."
            disabled={submitting}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={submitting}
          >
            Keep Sale
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Confirm Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default CancelSaleModal;

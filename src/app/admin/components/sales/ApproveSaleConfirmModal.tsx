
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";
import superAdminAgentService from "../../../services/superAdminAgentService";

interface ApproveSaleConfirmModalProps {
  open: boolean;
  onClose: () => void;
  saleId: string;
  customerName: string;
  onApproved: () => void;
}

const ApproveSaleConfirmModal: React.FC<ApproveSaleConfirmModalProps> = ({
  open,
  onClose,
  saleId,
  customerName,
  onApproved,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleApprove = async () => {
    try {
      setLoading(true);
      setError("");
      await superAdminAgentService.approveSale(saleId);
      onApproved();
    } catch (err: any) {
      setError(err.message || "Failed to approve sale");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Approve Sale
          </DialogTitle>
          <DialogDescription>
            Confirm that you want to approve this sale record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div className="p-4 bg-gray-50 rounded-lg border">
            <p className="text-sm text-gray-500 mb-1">Customer Name</p>
            <p className="font-semibold text-gray-900">{customerName || "Unknown Customer"}</p>
          </div>

          <p className="text-sm text-gray-600 italic">
            This action confirms that you have reviewed and verified this transaction. This will mark the sale as agent-approved.
          </p>

          <div className="flex justify-end space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Approve Sale
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ApproveSaleConfirmModal;

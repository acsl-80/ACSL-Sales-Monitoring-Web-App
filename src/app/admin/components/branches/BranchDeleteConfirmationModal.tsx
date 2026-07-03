import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { Branch } from "@/types/branches";

interface BranchDeleteConfirmationModalProps {
  open: boolean;
  branch: Branch | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const BranchDeleteConfirmationModal: React.FC<
  BranchDeleteConfirmationModalProps
> = ({ open, branch, onConfirm, onCancel }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  if (!branch) return null;

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <span>Delete Branch</span>
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-gray-600 mb-4">
            Are you sure you want to delete this branch? This action cannot be
            undone.
          </p>

          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div>
              <span className="font-medium text-gray-700">Branch: </span>
              <span className="text-gray-900">{branch.name}</span>
            </div>
            {branch.organizations && (
              <div>
                <span className="font-medium text-gray-700">
                  Organization:{" "}
                </span>
                <span className="text-gray-900">
                  {branch.organizations.partner_name}
                </span>
              </div>
            )}
            <div>
              <span className="font-medium text-gray-700">Location: </span>
              <span className="text-gray-900">
                {branch.country}
                {branch.state && `, ${branch.state}`}
                {branch.lga && `, ${branch.lga}`}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Deleting...
              </div>
            ) : (
              "Delete Branch"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BranchDeleteConfirmationModal;

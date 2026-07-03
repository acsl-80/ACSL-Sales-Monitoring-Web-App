
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";
import { SalesAgent } from "@/types/salesAgent";
import adminAgentService from "../../../services/adminAgentService.jsx";

interface DeleteAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agent: SalesAgent | null;
}

const DeleteAgentModal: React.FC<DeleteAgentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  agent,
}) => {
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  const handleClose = () => {
    setDeleteError("");
    onClose();
  };

  const handleDeleteAgent = async () => {
    if (!agent) {
      setDeleteError("No agent selected for deletion");
      return;
    }

    try {
      setDeleteLoading(true);
      setDeleteError("");

      const response = await adminAgentService.deleteAgent(agent.id);

      if (response.success) {
        // Close modal and notify parent
        handleClose();
        onSuccess();
      } else {
        setDeleteError(response.error || "Failed to delete agent");
      }
    } catch (err) {
      console.error("Error deleting agent:", err);
      setDeleteError("An unexpected error occurred while deleting the agent");
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!agent) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Delete Sales Agent
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the agent
            and remove their access to the system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {deleteError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">{deleteError}</span>
            </div>
          )}

          {/* Agent Info */}
          <div className="p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-brand-800 to-brand-900 w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white font-semibold">
                  {agent.full_name?.charAt(0)?.toUpperCase() || "A"}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  {agent.full_name || "N/A"}
                </p>
                <p className="text-sm text-gray-600">{agent.email || "N/A"}</p>
                {agent.phone && (
                  <p className="text-xs text-gray-500">{agent.phone}</p>
                )}
              </div>
            </div>
          </div>

          {/* Warning Message */}
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium">Warning:</p>
                <ul className="mt-1 list-disc list-inside space-y-1">
                  <li>The agent will lose access to the system immediately</li>
                  <li>This action cannot be undone</li>
                  <li>
                    If the agent has existing sales records, deletion may be
                    blocked
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteAgent}
              disabled={deleteLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Agent
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteAgentModal;

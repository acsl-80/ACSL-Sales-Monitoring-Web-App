
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
import superAdminAgentService from "../../services/superAdminAgentService";

interface Agent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  created_at: string;
  assigned_organizations_count: number;
  assigned_states_count: number;
}

interface DeleteSuperAdminAgentModalProps {
  agent: Agent;
  onClose: () => void;
  onSuccess: () => void;
}

const DeleteSuperAdminAgentModal: React.FC<DeleteSuperAdminAgentModalProps> = ({
  agent,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleClose = () => {
    setError("");
    onClose();
  };

  const handleDelete = async () => {
    try {
      setLoading(true);
      setError("");
      await superAdminAgentService.deleteSuperAdminAgent(agent.id);
      handleClose();
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to delete agent");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Delete ACSL Agent
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. The agent will permanently lose access
            to the system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">{error}</span>
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
                <p className="font-medium text-gray-900">{agent.full_name}</p>
                <p className="text-sm text-gray-600">{agent.email}</p>
                {agent.phone && (
                  <p className="text-xs text-gray-500">{agent.phone}</p>
                )}
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium">Warning:</p>
                <ul className="mt-1 list-disc list-inside space-y-1">
                  <li>
                    The agent will lose access to the system immediately
                  </li>
                  <li>
                    All organization assignments will be removed
                  </li>
                  <li>This action cannot be undone</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {loading ? (
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

export default DeleteSuperAdminAgentModal;

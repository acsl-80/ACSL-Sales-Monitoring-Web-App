
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormGrid, FormFieldWrapper } from "@/components/ui/form-grid";
import { AlertCircle, Save, Loader2 } from "lucide-react";
import { SalesAgent } from "@/types/salesAgent";
import adminAgentService from "../../../services/adminAgentService.jsx";

interface EditAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agent: SalesAgent | null;
}

interface UpdateAgentData {
  full_name?: string;
  email?: string;
  phone?: string;
}

const EditAgentModal: React.FC<EditAgentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  agent,
}) => {
  const [updateForm, setUpdateForm] = useState<UpdateAgentData>({
    full_name: "",
    email: "",
    phone: "",
  });
  const [updateLoading, setUpdateLoading] = useState<boolean>(false);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  // Initialize form when agent changes or modal opens
  useEffect(() => {
    if (agent && isOpen) {
      setUpdateForm({
        full_name: agent.full_name || "",
        email: agent.email || "",
        phone: agent.phone || "",
      });
      setUpdateErrors({});
    }
  }, [agent, isOpen]);

  const resetForm = () => {
    setUpdateForm({
      full_name: "",
      email: "",
      phone: "",
    });
    setUpdateErrors({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validateForm = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!updateForm.full_name?.trim()) {
      errors.push("Full name is required");
    } else if (updateForm.full_name.trim().length < 2) {
      errors.push("Full name must be at least 2 characters long");
    }

    if (!updateForm.email?.trim()) {
      errors.push("Email is required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updateForm.email)) {
      errors.push("Please enter a valid email address");
    }

    return { isValid: errors.length === 0, errors };
  };

  const handleUpdateAgent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!agent) {
      setUpdateErrors({
        general: "No agent selected for update",
      });
      return;
    }

    // Validate form
    const validation = validateForm();

    if (!validation.isValid) {
      const errorMap: Record<string, string> = {};
      validation.errors.forEach((error: string, index: number) => {
        errorMap[index.toString()] = error;
      });
      setUpdateErrors(errorMap);
      return;
    }

    try {
      setUpdateLoading(true);
      setUpdateErrors({});

      // Prepare update data (only send changed fields)
      const updates: UpdateAgentData = {};

      if (updateForm.full_name?.trim() !== agent.full_name) {
        updates.full_name = updateForm.full_name?.trim();
      }

      if (updateForm.email?.trim() !== agent.email) {
        updates.email = updateForm.email?.trim();
      }

      if (updateForm.phone?.trim() !== (agent.phone || "")) {
        updates.phone = updateForm.phone?.trim() || undefined;
      }

      // Check if there are any changes
      if (Object.keys(updates).length === 0) {
        setUpdateErrors({
          general: "No changes detected",
        });
        return;
      }

      const response = await adminAgentService.updateAgent(agent.id, updates);

      if (response.success) {
        // Reset form and close modal
        resetForm();
        handleClose();

        // Notify parent component
        onSuccess();
      } else {
        setUpdateErrors({
          general: response.error || "Failed to update agent",
        });
      }
    } catch (err) {
      console.error("Error updating agent:", err);
      setUpdateErrors({
        general: "An unexpected error occurred while updating the agent",
      });
    } finally {
      setUpdateLoading(false);
    }
  };

  if (!agent) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Edit Sales Agent</DialogTitle>
          <DialogDescription>
            Update the agent&apos;s information. All fields are required.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleUpdateAgent} className="space-y-4">
          {updateErrors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">
                {updateErrors.general}
              </span>
            </div>
          )}

          {/* Display validation errors */}
          {Object.entries(updateErrors).map(([key, error]) => {
            if (key !== "general") {
              return (
                <div
                  key={key}
                  className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
                >
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-red-700 text-sm">{error}</span>
                </div>
              );
            }
            return null;
          })}

          <FormGrid>
            <FormFieldWrapper>
              <Label htmlFor="updateName">Full Name *</Label>
              <Input
                id="updateName"
                value={updateForm.full_name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUpdateForm((prev) => ({
                    ...prev,
                    full_name: e.target.value,
                  }))
                }
                placeholder="Enter agent's full name"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="updateEmail">Email Address *</Label>
              <Input
                id="updateEmail"
                type="email"
                value={updateForm.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUpdateForm((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
                placeholder="Enter agent's email address"
              />
            </FormFieldWrapper>

            <FormFieldWrapper fullWidth>
              <Label htmlFor="updatePhone">Phone Number *</Label>
              <Input
                id="updatePhone"
                type="tel"
                value={updateForm.phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUpdateForm((prev) => ({
                    ...prev,
                    phone: e.target.value,
                  }))
                }
                placeholder="Enter agent's phone number"
              />
            </FormFieldWrapper>
          </FormGrid>

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={updateLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateLoading}
              className="bg-brand hover:bg-brand-700 text-white"
            >
              {updateLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Update Agent
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditAgentModal;

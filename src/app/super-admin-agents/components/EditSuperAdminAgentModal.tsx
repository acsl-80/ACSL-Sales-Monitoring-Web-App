
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Save, Loader2 } from "lucide-react";
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

interface EditSuperAdminAgentModalProps {
  agent: Agent;
  onClose: () => void;
  onSuccess: (updated: Agent) => void;
}

const EditSuperAdminAgentModal: React.FC<EditSuperAdminAgentModalProps> = ({
  agent,
  onClose,
  onSuccess,
}) => {
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    status: "active" as "active" | "disabled",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({
      full_name: agent.full_name || "",
      phone: agent.phone || "",
      status: (agent.status as "active" | "disabled") || "active",
    });
    setErrors({});
  }, [agent]);

  const handleClose = () => {
    setErrors({});
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!form.full_name.trim()) {
      setErrors({ general: "Full name is required" });
      return;
    }

    const updates: Record<string, string> = {};
    if (form.full_name.trim() !== agent.full_name)
      updates.full_name = form.full_name.trim();
    if ((form.phone.trim() || null) !== agent.phone)
      updates.phone = form.phone.trim();
    if (form.status !== agent.status) updates.status = form.status;

    if (Object.keys(updates).length === 0) {
      setErrors({ general: "No changes detected" });
      return;
    }

    try {
      setLoading(true);
      setErrors({});
      const result = await superAdminAgentService.updateSuperAdminAgent(
        agent.id,
        updates
      );
      onSuccess({ ...result.data, assigned_organizations_count: agent.assigned_organizations_count, assigned_states_count: agent.assigned_states_count });
    } catch (err: any) {
      setErrors({ general: err.message || "Failed to update agent" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Edit ACSL Agent</DialogTitle>
          <DialogDescription>
            Update agent profile information and status.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">{errors.general}</span>
            </div>
          )}

          <FormGrid>
            <FormFieldWrapper>
              <Label htmlFor="editSaaName">Full Name *</Label>
              <Input
                id="editSaaName"
                value={form.full_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, full_name: e.target.value }))
                }
                placeholder="Enter full name"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="editSaaPhone">Phone Number</Label>
              <Input
                id="editSaaPhone"
                type="tel"
                value={form.phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="Enter phone number (optional)"
              />
            </FormFieldWrapper>

            <FormFieldWrapper fullWidth>
              <Label htmlFor="editSaaStatus">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    status: v as "active" | "disabled",
                  }))
                }
              >
                <SelectTrigger id="editSaaStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </FormFieldWrapper>
          </FormGrid>

          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-brand hover:bg-brand-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditSuperAdminAgentModal;

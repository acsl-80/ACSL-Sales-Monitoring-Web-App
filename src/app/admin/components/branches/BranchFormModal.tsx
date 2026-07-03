import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid, FormFieldWrapper } from "@/components/ui/form-grid";
import { lgaAndStates } from "@/app/constants";
import adminBranchesService from "@/app/services/adminBranchesService";
import superAdminBranchesService from "@/app/services/superAdminBranchesService";
import type {
  Branch,
  CreateBranchData,
  UpdateBranchData,
} from "@/types/branches";
import { useAuth } from "@/app/contexts/useAuth";

interface BranchFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (branchData: Branch) => void;
  mode: "create" | "edit";
  branchData?: Branch | null;
  organizationId?: string;
  organizationName?: string;
  isSuperAdmin?: boolean;
}

const BranchFormModal: React.FC<BranchFormModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  mode,
  branchData,
  organizationId,
  organizationName,
  isSuperAdmin = false,
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    country: "Nigeria",
    state: "",
    lga: "",
  });

  const countries = ["Nigeria", "Ghana", "Kenya", "South Africa"];
  const nigerianStates = Object.keys(lgaAndStates).sort();
  const lgas =
    formData.state && formData.country === "Nigeria"
      ? (lgaAndStates as Record<string, string[]>)[formData.state] || []
      : [];

  // Reset form when modal opens/closes or mode changes
  useEffect(() => {
    if (open) {
      if (mode === "edit" && branchData) {
        setFormData({
          name: branchData.name,
          country: branchData.country,
          state: branchData.state || "",
          lga: branchData.lga || "",
        });
      } else {
        setFormData({
          name: "",
          country: "Nigeria",
          state: "",
          lga: "",
        });
      }
      setErrors([]);
    }
  }, [open, mode, branchData]);

  // Clear LGA when state changes
  useEffect(() => {
    if (formData.country !== "Nigeria") {
      setFormData((prev) => ({ ...prev, state: "", lga: "" }));
    } else if (
      formData.state &&
      lgas.length > 0 &&
      !lgas.includes(formData.lga)
    ) {
      setFormData((prev) => ({ ...prev, lga: "" }));
    }
  }, [formData.country, formData.state, lgas]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear errors when user starts typing
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors([]);

    try {
      // Choose service based on admin type
      const service = isSuperAdmin
        ? superAdminBranchesService
        : adminBranchesService;

      // Validate form data
      const validation = service.validateBranchData(formData);
      if (!validation.isValid) {
        setErrors(validation.errors);
        return;
      }

      let response;
      if (mode === "create") {
        if (!organizationId) {
          setErrors(["Organization ID is required for creating branches"]);
          return;
        }
        if (isSuperAdmin) {
          response = await superAdminBranchesService.createPartnerBranch(
            organizationId,
            formData as CreateBranchData
          );
        } else {
          response = await adminBranchesService.createBranch(
            organizationId,
            formData as CreateBranchData
          );
        }
      } else {
        if (!branchData?.id) {
          setErrors(["Branch ID is required for updating"]);
          return;
        }
        if (isSuperAdmin) {
          response = await superAdminBranchesService.updatePartnerBranch(
            branchData.id,
            formData as UpdateBranchData
          );
        } else {
          response = await adminBranchesService.updateBranch(
            branchData.id,
            formData as UpdateBranchData
          );
        }
      }

      if (response.success && response.data) {
        onSuccess(response.data);
        onOpenChange(false);
      } else {
        setErrors([response.error || `Failed to ${mode} branch`]);
      }
    } catch (error) {
      console.error(`Error ${mode}ing branch:`, error);
      setErrors([`An unexpected error occurred while ${mode}ing branch`]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create New Branch" : "Edit Branch"}
            {organizationName && (
              <span className="text-sm font-normal text-gray-600 block mt-1">
                for {organizationName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <ul className="text-sm text-red-600 space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          <FormGrid>
            {/* Branch Name */}
            <FormFieldWrapper fullWidth>
              <Label htmlFor="name">Branch Name *</Label>
              <Input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="Enter branch name"
                required
                maxLength={100}
              />
            </FormFieldWrapper>

            {/* State (Nigeria only) */}
            {formData.country === "Nigeria" && (
              <FormFieldWrapper>
                <Label htmlFor="state">State</Label>
                <Select
                  value={formData.state || undefined}
                  onValueChange={(value) =>
                    handleInputChange("state", value || "")
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {nigerianStates.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormFieldWrapper>
            )}

            {/* LGA (Nigeria only, when state is selected) */}
            {formData.country === "Nigeria" &&
              formData.state &&
              lgas.length > 0 && (
                <FormFieldWrapper>
                  <Label htmlFor="lga">Local Government Area</Label>
                  <Select
                    value={formData.lga || undefined}
                    onValueChange={(value) =>
                      handleInputChange("lga", value || "")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select LGA" />
                    </SelectTrigger>
                    <SelectContent>
                      {lgas.map((lga) => (
                        <SelectItem key={lga} value={lga}>
                          {lga}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormFieldWrapper>
              )}
          </FormGrid>

          <DialogFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {mode === "create" ? "Creating..." : "Updating..."}
                </div>
              ) : mode === "create" ? (
                "Create Branch"
              ) : (
                "Update Branch"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BranchFormModal;


import React, { useState } from "react";
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
  AlertCircle,
  UserPlus,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
} from "lucide-react";
import { CreateAgentRequest } from "@/types/salesAgent";
import adminAgentService from "../../../services/adminAgentService.jsx";

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credentials: {
    name: string;
    email: string;
    password: string;
  }) => void;
  onAgentCreated: () => void;
}

const CreateAgentModal: React.FC<CreateAgentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onAgentCreated,
}) => {
  const [createForm, setCreateForm] = useState<CreateAgentRequest>({
    name: "",
    email: "",
    password: "",
    phone: "",
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const resetForm = () => {
    setCreateForm({ name: "", email: "", password: "", phone: "" });
    setConfirmPassword("");
    setCreateErrors({});
    setShowPassword(false);
    setShowConfirmPassword(false);
    setCopyMessage("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const generatePassword = () => {
    const length = 12;
    const charset =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let password = "";

    // Ensure at least one character from each category
    password += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)]; // Uppercase
    password += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]; // Lowercase
    password += "0123456789"[Math.floor(Math.random() * 10)]; // Number
    password += "!@#$%^&*"[Math.floor(Math.random() * 8)]; // Special character

    // Fill the rest randomly
    for (let i = 4; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }

    // Shuffle the password
    password = password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");

    setCreateForm((prev) => ({ ...prev, password }));
    setConfirmPassword(password);

    // Copy to clipboard
    copyToClipboard(password);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Password copied to clipboard!");
      setTimeout(() => setCopyMessage(""), 3000);
    } catch (err) {
      console.error("Failed to copy password:", err);
      setCopyMessage("Failed to copy password");
      setTimeout(() => setCopyMessage(""), 3000);
    }
  };

  const validateForm = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!createForm.name.trim()) {
      errors.push("Full name is required");
    }

    if (!createForm.email.trim()) {
      errors.push("Email is required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email)) {
      errors.push("Please enter a valid email address");
    }

    if (!createForm.password) {
      errors.push("Password is required");
    } else if (createForm.password.length < 6) {
      errors.push("Password must be at least 6 characters long");
    }

    if (!confirmPassword) {
      errors.push("Please confirm the password");
    } else if (createForm.password !== confirmPassword) {
      errors.push("Passwords do not match");
    }

    if (!createForm.phone?.trim()) {
      errors.push("Phone number is required");
    }

    return { isValid: errors.length === 0, errors };
  };

  const handleCreateAgent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Validate form
    const validation = validateForm();

    if (!validation.isValid) {
      const errorMap: Record<string, string> = {};
      validation.errors.forEach((error: string, index: number) => {
        errorMap[index.toString()] = error;
      });
      setCreateErrors(errorMap);
      return;
    }

    try {
      setCreateLoading(true);
      setCreateErrors({});

      const response = await adminAgentService.createAgent(
        createForm.name,
        createForm.email,
        createForm.password,
        createForm.phone as any
      );

      if (response.success) {
        // Pass credentials to parent
        onSuccess({
          name: createForm.name,
          email: createForm.email,
          password: createForm.password,
        });

        // Reset form and close modal
        resetForm();
        handleClose();

        // Refresh agents list
        onAgentCreated();
      } else {
        setCreateErrors({
          general: response.error || "Failed to create agent",
        });
      }
    } catch (err) {
      console.error("Error creating agent:", err);

      // Extract the actual error message if available
      let errorMessage =
        "An unexpected error occurred while creating the agent";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "string") {
        errorMessage = err;
      }

      setCreateErrors({
        general: errorMessage,
      });
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Add New Sales Agent</DialogTitle>
          <DialogDescription>
            Create a new sales agent account. Required fields are email,
            password, and full name.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateAgent} className="space-y-4">
          {createErrors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">
                {createErrors.general}
              </span>
            </div>
          )}

          {/* Display validation errors */}
          {Object.entries(createErrors).map(([key, error]) => {
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
              <Label htmlFor="agentName">Full Name *</Label>
              <Input
                id="agentName"
                value={createForm.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
                placeholder="Enter agent's full name"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="agentEmail">Email Address *</Label>
              <Input
                id="agentEmail"
                type="email"
                value={createForm.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
                placeholder="Enter agent's email address"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="agentPhone">Phone Number *</Label>
              <Input
                id="agentPhone"
                type="tel"
                value={createForm.phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    phone: e.target.value,
                  }))
                }
                placeholder="Enter agent's phone number"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <div className="flex justify-between items-center">
                <Label htmlFor="agentPassword">Password *</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={generatePassword}
                  disabled={createLoading}
                  className="text-blue-600 hover:text-blue-800 p-0 h-auto text-sm"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Auto Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="agentPassword"
                  type={showPassword ? "text" : "password"}
                  value={createForm.password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  placeholder="Enter password"
                  className="pr-20"
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  {createForm.password && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(createForm.password)}
                      disabled={createLoading}
                      className="h-8 w-8 p-0 mr-1"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={createLoading}
                    className="h-8 w-8 p-0 mr-1"
                  >
                    {showPassword ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="confirmPassword">Confirm Password *</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setConfirmPassword(e.target.value)
                  }
                  placeholder="Confirm password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={createLoading}
                  className="absolute inset-y-0 right-0 h-8 w-8 p-0 mr-1"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </FormFieldWrapper>
          </FormGrid>

          {/* Copy Message */}
          {copyMessage && (
            <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
              {copyMessage}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createLoading}
              className="bg-brand hover:bg-brand-700 text-white"
            >
              {createLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create Agent
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateAgentModal;

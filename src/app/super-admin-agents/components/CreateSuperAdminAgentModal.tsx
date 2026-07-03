
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  UserPlus,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
} from "lucide-react";
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

interface CreateSuperAdminAgentModalProps {
  onClose: () => void;
  onSuccess: (agent: Agent) => void;
}

const CreateSuperAdminAgentModal: React.FC<CreateSuperAdminAgentModalProps> = ({
  onClose,
  onSuccess,
}) => {
  const [form, setForm] = useState({
    role: "acsl_agent",
    full_name: "",
    email: "",
    password: "",
    phone: "",
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const resetForm = () => {
    setForm({ role: "acsl_agent", full_name: "", email: "", password: "", phone: "" });
    setConfirmPassword("");
    setErrors({});
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
    password += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
    password += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
    password += "0123456789"[Math.floor(Math.random() * 10)];
    password += "!@#$%^&*"[Math.floor(Math.random() * 8)];
    for (let i = 4; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    password = password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
    setForm((prev) => ({ ...prev, password }));
    setConfirmPassword(password);
    copyToClipboard(password);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Password copied to clipboard!");
      setTimeout(() => setCopyMessage(""), 3000);
    } catch {
      setCopyMessage("Failed to copy password");
      setTimeout(() => setCopyMessage(""), 3000);
    }
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!form.full_name.trim()) errs.push("Full name is required");
    if (!form.email.trim()) errs.push("Email is required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.push("Please enter a valid email address");
    if (!form.password) errs.push("Password is required");
    else if (form.password.length < 6)
      errs.push("Password must be at least 6 characters");
    if (!confirmPassword) errs.push("Please confirm the password");
    else if (form.password !== confirmPassword) errs.push("Passwords do not match");
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validationErrors = validate();
    if (validationErrors.length > 0) {
      const errorMap: Record<string, string> = {};
      validationErrors.forEach((err, i) => { errorMap[i.toString()] = err; });
      setErrors(errorMap);
      return;
    }

    try {
      setLoading(true);
      setErrors({});
      const result = await superAdminAgentService.createSuperAdminAgent({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        role: form.role,
      });
      onSuccess({ ...result.data, assigned_organizations_count: 0, assigned_states_count: 0 });
      resetForm();
    } catch (err: any) {
      setErrors({ general: err.message || "Failed to create agent" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            {form.role === "super_admin"
              ? "Add Super Admin"
              : form.role === "acsl_agent_manager"
              ? "Add ACSL Agent Manager"
              : "Add ACSL Agent"}
          </DialogTitle>
          <DialogDescription>
            {form.role === "super_admin"
              ? "Create a new super admin account with full system access."
              : form.role === "acsl_agent_manager"
              ? "Create a new ACSL Agent Manager. They will be assigned to states and partners, and can create ACSL agents under them."
              : "Create a new ACSL Agent account. They will be assigned to partner organizations after creation."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">{errors.general}</span>
            </div>
          )}
          {Object.entries(errors).map(([key, error]) =>
            key !== "general" ? (
              <div
                key={key}
                className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 text-red-600" />
                <span className="text-red-700 text-sm">{error}</span>
              </div>
            ) : null
          )}

          <FormGrid>
            <FormFieldWrapper fullWidth>
              <Label>Role *</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((prev) => ({ ...prev, role: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acsl_agent">ACSL Agent</SelectItem>
                  <SelectItem value="acsl_agent_manager">ACSL Agent Manager</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
              {form.role === "super_admin" && (
                <p className="text-xs text-orange-600 mt-1">
                  Super Admin users have full system access. Use with caution.
                </p>
              )}
            </FormFieldWrapper>

            <FormFieldWrapper fullWidth>
              <Label htmlFor="saaName">Full Name *</Label>
              <Input
                id="saaName"
                value={form.full_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, full_name: e.target.value }))
                }
                placeholder="Enter full name"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="saaEmail">Email Address *</Label>
              <Input
                id="saaEmail"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="Enter email address"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <Label htmlFor="saaPhone">Phone Number</Label>
              <Input
                id="saaPhone"
                type="tel"
                value={form.phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="Enter phone number (optional)"
              />
            </FormFieldWrapper>

            <FormFieldWrapper>
              <div className="flex justify-between items-center">
                <Label htmlFor="saaPassword">Password *</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={generatePassword}
                  disabled={loading}
                  className="text-blue-600 hover:text-blue-800 p-0 h-auto text-sm"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Auto Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="saaPassword"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, password: e.target.value }))
                  }
                  placeholder="Enter password"
                  className="pr-20"
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  {form.password && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(form.password)}
                      disabled={loading}
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
                    disabled={loading}
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
              <Label htmlFor="saaConfirmPassword">Confirm Password *</Label>
              <div className="relative">
                <Input
                  id="saaConfirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={loading}
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

          {copyMessage && (
            <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
              {copyMessage}
            </div>
          )}

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
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  {form.role === "super_admin"
                ? "Create Super Admin"
                : form.role === "acsl_agent_manager"
                ? "Create Agent Manager"
                : "Create Agent"}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateSuperAdminAgentModal;

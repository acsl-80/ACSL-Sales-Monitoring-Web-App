
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, RefreshCw, Copy, Check, Key, Wand2, AlertTriangle, Shield } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import adminCredentialsService, {
  Credential,
} from "@/app/services/adminCredentialsService";

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  credential: Credential | null;
  onSuccess: () => void;
}

const SectionCard = ({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`bg-muted/30 rounded-lg p-3 border border-border/50 ${className}`}>
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
      {title}
    </h3>
    {children}
  </div>
);

const DetailItem = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="space-y-0">
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
    <p className="text-xs font-medium">{value ?? <span className="text-gray-400">N/A</span>}</p>
  </div>
);

const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  credential,
  onSuccess,
}) => {
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [passwordMode, setPasswordMode] = useState("");

  const [useCustomPassword, setUseCustomPassword] = useState(false);
  const [customPassword, setCustomPassword] = useState("");
  const [showCustomPassword, setShowCustomPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAdminPassword("");
      setError("");
      setSuccess(false);
      setNewPassword("");
      setCopied(false);
      setPasswordMode("");
      setUseCustomPassword(false);
      setCustomPassword("");
    }
  }, [isOpen]);

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError("Failed to copy password"); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!credential) return;
    if (!adminPassword) { setError("Please enter your admin password"); return; }
    if (useCustomPassword) {
      if (!customPassword) { setError("Please enter a custom password"); return; }
      if (customPassword.length < 8) { setError("Custom password must be at least 8 characters long"); return; }
    }

    setLoading(true);
    try {
      const response = await adminCredentialsService.resetPassword(
        credential.partner_id,
        adminPassword,
        useCustomPassword ? customPassword : undefined
      );
      if (response.success && response.data) {
        setSuccess(true);
        setNewPassword(response.data.newPassword);
        setPasswordMode(response.data.passwordMode || "auto-generated");
        onSuccess();
      } else {
        setError(response.error || "Failed to reset password");
      }
    } catch { setError("An unexpected error occurred"); }
    finally { setLoading(false); }
  };

  const handleClose = () => {
    setAdminPassword("");
    setError("");
    setSuccess(false);
    setNewPassword("");
    setShowAdminPassword(false);
    setCopied(false);
    setPasswordMode("");
    setUseCustomPassword(false);
    setCustomPassword("");
    setShowCustomPassword(false);
    onClose();
  };

  if (!credential) return null;

  const loginValue = credential.is_dummy_email
    ? credential.username ?? ""
    : credential.email ?? credential.organizations?.email ?? "";

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4 text-amber-600" />
            Reset Password
          </DialogTitle>
        </DialogHeader>

        {!success ? (
          <form onSubmit={handleSubmit} className="space-y-3 mt-1">
            {/* Partner summary */}
            <SectionCard title="Partner Information">
              <div className="grid grid-cols-3 gap-3">
                <DetailItem label="Partner ID" value={<span className="font-mono">{credential.partner_id}</span>} />
                <DetailItem label="Partner Name" value={credential.partner_name} />
                <DetailItem
                  label={credential.is_dummy_email ? "Username" : "Email"}
                  value={loginValue}
                />
              </div>
            </SectionCard>

            {/* Password mode toggle */}
            <SectionCard title="Password Mode">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {useCustomPassword
                    ? <Key className="h-4 w-4 text-brand" />
                    : <Wand2 className="h-4 w-4 text-brand" />}
                  <div>
                    <p className="text-xs font-semibold text-gray-800">
                      {useCustomPassword ? "Custom Password" : "Auto-Generate Password"}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {useCustomPassword
                        ? "You will provide the new password"
                        : "System generates a secure 16-character password"}
                    </p>
                  </div>
                </div>
                <Switch checked={useCustomPassword} onCheckedChange={setUseCustomPassword} />
              </div>
            </SectionCard>

            {/* Custom password input */}
            {useCustomPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="customPassword" className="text-xs font-medium">
                  Custom Password <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="customPassword"
                    type={showCustomPassword ? "text" : "password"}
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    placeholder="Enter custom password (min 8 chars)"
                    required={useCustomPassword}
                    className="pr-10 h-9 text-sm"
                  />
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowCustomPassword(!showCustomPassword)}
                  >
                    {showCustomPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-[11px] text-gray-400">Minimum 8 characters</p>
              </div>
            )}

            {/* Admin password verification */}
            <div className="space-y-1.5">
              <Label htmlFor="adminPassword" className="text-xs font-medium text-red-600">
                Your Admin Password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="adminPassword"
                  type={showAdminPassword ? "text" : "password"}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter your password to verify identity"
                  required
                  className="pr-10 h-9 text-sm"
                />
                <Button
                  type="button" variant="ghost" size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowAdminPassword(!showAdminPassword)}
                >
                  {showAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-gray-400">Required to confirm your identity before making changes</p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2.5 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            {/* Warning */}
            <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                This will immediately change the organization's login password. Communicate the new password to them securely.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white">
                {loading ? (
                  <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />Resetting...</>
                ) : (
                  <><Key className="mr-1.5 h-3.5 w-3.5" />Reset Password</>
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 mt-1">
            {/* Success banner */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <div className="bg-green-500 rounded-full p-1.5 flex-shrink-0">
                <Check className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-green-900">Password Reset Successfully!</p>
                <p className="text-xs text-green-700">
                  A new {passwordMode === "auto-generated" ? "auto-generated secure" : "custom"} password has been set for <span className="font-medium">{credential.partner_name}</span>.
                </p>
              </div>
              <div className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                passwordMode === "auto-generated" ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"
              }`}>
                {passwordMode === "auto-generated"
                  ? <><Wand2 className="h-3 w-3" />Auto-Generated</>
                  : <><Key className="h-3 w-3" />Custom</>}
              </div>
            </div>

            {/* New password display */}
            <SectionCard title="New Password">
              <div className="bg-white border-2 border-brand rounded-md px-4 py-3 flex items-center justify-between gap-3">
                <span className="font-mono text-base font-bold text-brand tracking-widest break-all">
                  {newPassword}
                </span>
                <Button variant="outline" size="sm" onClick={handleCopyPassword} className="shrink-0 h-8">
                  {copied
                    ? <><Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />Copied!</>
                    : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy</>}
                </Button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Copy and securely communicate this password to the organization.
              </p>
            </SectionCard>

            {/* Partner reminder */}
            <SectionCard title="Partner Details">
              <div className="grid grid-cols-3 gap-3">
                <DetailItem label="Partner ID" value={<span className="font-mono">{credential.partner_id}</span>} />
                <DetailItem label="Partner Name" value={credential.partner_name} />
                <DetailItem label={credential.is_dummy_email ? "Username" : "Email"} value={loginValue} />
              </div>
            </SectionCard>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <Button size="sm" onClick={handleClose} className="bg-brand hover:bg-brand/90 text-white">
                <Shield className="h-3.5 w-3.5 mr-1.5" />Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordModal;

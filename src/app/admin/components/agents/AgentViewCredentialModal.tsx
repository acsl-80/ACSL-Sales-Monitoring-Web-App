
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Copy,
  Eye,
  EyeOff,
  Check,
  Shield,
  RefreshCw,
  KeyRound,
  Loader2,
} from "lucide-react";
import tokenManager from "@/utils/tokenManager";

export interface AgentCredential {
  id?: string;
  user_id?: string;
  email?: string;
  username?: string;
  password: string;
  role?: string;
  partner_name?: string;
  is_dummy_email?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface AgentViewCredentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  credential: AgentCredential | null;
  agentName?: string;
  /** If true, shows password-reset section (super admin / manager view) */
  canResetPassword?: boolean;
}

function generatePassword(length = 12): string {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const special = "!@#$%^&*";
  const all = lower + upper + digits + special;
  let pw = [
    lower[Math.floor(Math.random() * lower.length)],
    upper[Math.floor(Math.random() * upper.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ];
  for (let i = pw.length; i < length; i++) pw.push(all[Math.floor(Math.random() * all.length)]);
  return pw.sort(() => Math.random() - 0.5).join("");
}

const AgentViewCredentialModal: React.FC<AgentViewCredentialModalProps> = ({
  isOpen,
  onClose,
  credential,
  agentName,
  canResetPassword = false,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [resetMode, setResetMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [displayedCredential, setDisplayedCredential] = useState<AgentCredential | null>(null);

  const activeCredential = displayedCredential ?? credential;

  const copy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  const handleRegenerate = () => {
    setNewPassword(generatePassword());
  };

  const handleReset = async () => {
    if (!activeCredential?.user_id || !newPassword) return;
    if (newPassword.length < 8) { setResetError("Password must be at least 8 characters"); return; }

    setResetting(true);
    setResetError(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const token = await tokenManager.getValidToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/manage-credentials/reset-agent-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: activeCredential.user_id, new_password: newPassword }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to reset password");

      setDisplayedCredential({ ...activeCredential, password: newPassword, updated_at: new Date().toISOString() });
      setResetSuccess(true);
      setResetMode(false);
      setNewPassword("");
    } catch (err: any) {
      setResetError(err.message ?? "Failed to reset password");
    } finally {
      setResetting(false);
    }
  };

  const handleClose = () => {
    setResetMode(false);
    setNewPassword("");
    setResetError(null);
    setResetSuccess(false);
    setDisplayedCredential(null);
    setShowPassword(false);
    setShowNewPassword(false);
    onClose();
  };

  if (!activeCredential) return null;

  const loginValue = activeCredential.is_dummy_email
    ? activeCredential.username ?? ""
    : activeCredential.email ?? "";

  const formatDate = (d?: string) =>
    d
      ? new Date(d).toLocaleString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : "—";

  const CopyBtn = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => copy(text, field)}
      className="p-1 rounded hover:bg-muted transition-colors"
      title="Copy"
    >
      {copiedField === field ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-brand" />
            {resetSuccess ? "Password Updated" : "Agent Credentials"}
            {agentName && (
              <span className="text-sm font-normal text-muted-foreground ml-1">— {agentName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {/* Credential details */}
          <div className="bg-muted/30 rounded-lg p-3 border border-border/50 space-y-2">
            <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
              Login Credentials
            </h3>

            {/* Login / Email */}
            <div className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {activeCredential.is_dummy_email ? "Username" : "Email"}
                </p>
                <p className="text-sm font-mono font-medium">{loginValue}</p>
              </div>
              <CopyBtn text={loginValue} field="login" />
            </div>

            {/* Password */}
            <div className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Password</p>
                <p className="text-sm font-mono font-medium">
                  {showPassword ? activeCredential.password : "•".repeat(Math.min(activeCredential.password.length, 16))}
                  {resetSuccess && (
                    <span className="ml-2 text-[10px] text-green-600 font-sans">(updated)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowPassword((v) => !v)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title={showPassword ? "Hide" : "Show"}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                <CopyBtn text={activeCredential.password} field="password" />
              </div>
            </div>

            {/* Role */}
            {activeCredential.role && (
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Role</p>
                  <p className="text-sm capitalize">{activeCredential.role.replace(/_/g, " ")}</p>
                </div>
              </div>
            )}

            {/* Dates */}
            {activeCredential.created_at && (
              <div className="pt-1 text-[11px] text-muted-foreground border-t border-border/30">
                Created: {formatDate(activeCredential.created_at)}
                {activeCredential.updated_at && activeCredential.updated_at !== activeCredential.created_at && (
                  <span className="ml-3">Updated: {formatDate(activeCredential.updated_at)}</span>
                )}
              </div>
            )}
          </div>

          {/* Copy all */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() =>
              copy(
                `Login: ${loginValue}\nPassword: ${activeCredential.password}`,
                "all"
              )
            }
          >
            {copiedField === "all" ? (
              <><Check className="h-4 w-4 mr-2 text-green-600" />Copied!</>
            ) : (
              <><Copy className="h-4 w-4 mr-2" />Copy Credentials</>
            )}
          </Button>

          {/* Password reset section */}
          {canResetPassword && (
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                  Reset Password
                </h3>
                {!resetMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setResetMode(true); setResetError(null); setResetSuccess(false); }}
                  >
                    <KeyRound className="h-3.5 w-3.5 mr-1" />
                    Reset Password
                  </Button>
                )}
              </div>

              {resetMode && (
                <div className="space-y-3 mt-1">
                  <div className="space-y-1">
                    <Label className="text-xs">New Password</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min 8 characters"
                          className="pr-8 text-sm h-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2"
                        >
                          {showNewPassword ? (
                            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 shrink-0"
                        onClick={handleRegenerate}
                        title="Generate password"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {resetError && (
                    <p className="text-xs text-red-600">{resetError}</p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-brand hover:bg-brand/90 text-white"
                      onClick={handleReset}
                      disabled={resetting || !newPassword}
                    >
                      {resetting ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Resetting…</>
                      ) : (
                        "Proceed"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => { setResetMode(false); setNewPassword(""); setResetError(null); }}
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    The agent will receive an email with their new credentials.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentViewCredentialModal;

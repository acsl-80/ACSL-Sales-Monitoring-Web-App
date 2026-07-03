
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Eye, EyeOff, Check, Building2, Key, Shield, Calendar } from "lucide-react";
import { Credential } from "@/app/services/adminCredentialsService";

interface ViewCredentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  credential: Credential | null;
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

const ViewCredentialModal: React.FC<ViewCredentialModalProps> = ({
  isOpen,
  onClose,
  credential,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  if (!credential) return null;

  const loginValue = credential.is_dummy_email
    ? credential.username ?? ""
    : credential.email ?? credential.organizations?.email ?? "";

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-brand" />
            Credential Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {/* Login credentials */}
          <SectionCard title="Login Credentials">
            <div className="space-y-3">
              {/* Email / Username */}
              <div className="space-y-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  {credential.is_dummy_email ? "Username" : "Email"}
                </p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-medium font-mono">{loginValue}</span>
                  <button
                    onClick={() => copy(loginValue, "login")}
                    className="text-gray-400 hover:text-brand transition-colors"
                    title="Copy"
                  >
                    {copiedField === "login"
                      ? <Check className="h-3.5 w-3.5 text-green-600" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Password */}
              <div className="space-y-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Password</p>
                <div className="flex items-center justify-between mt-0.5 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                  <span className="font-mono text-xs font-semibold text-brand tracking-widest">
                    {showPassword ? credential.password : "•".repeat(Math.min((credential.password ?? "").length, 16))}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-brand transition-colors"
                      title={showPassword ? "Hide" : "Show"}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => copy(credential.password, "password")}
                      className="text-gray-400 hover:text-brand transition-colors"
                      title="Copy"
                    >
                      {copiedField === "password"
                        ? <Check className="h-3.5 w-3.5 text-green-600" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Organization details */}
          {/* {credential.organizations && (
            <SectionCard title="Organization Details">
              <div className="grid grid-cols-2 gap-3">
                {credential.organizations.partner_name && (
                  <DetailItem label="Organization Name" value={credential.organizations.partner_name} />
                )}
                {credential.organizations.contact_person && (
                  <DetailItem label="Contact Person" value={credential.organizations.contact_person} />
                )}
                {credential.organizations.branch && (
                  <DetailItem label="Branch" value={credential.organizations.branch} />
                )}
                {credential.organizations.email && (
                  <DetailItem label="Organization Email" value={credential.organizations.email} />
                )}
              </div>
            </SectionCard>
          )} */}

          {/* Metadata + Quick Copy */}
          {/* <div className="grid grid-cols-2 gap-3">
            <SectionCard title="Metadata">
              <div className="space-y-2">
                <DetailItem
                  label="Created At"
                  value={<span className="flex items-center gap-1"><Calendar className="h-3 w-3 text-gray-400" />{formatDate(credential.created_at)}</span>}
                />
                {credential.updated_at && (
                  <DetailItem
                    label="Last Updated"
                    value={formatDate(credential.updated_at)}
                  />
                )}
              </div>
            </SectionCard>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h3 className="text-[10px] font-semibold text-blue-800 uppercase tracking-wider border-b border-blue-200 pb-0.5 mb-2">
                Quick Copy
              </h3>
              <p className="text-xs text-blue-600 mb-2">Copy all credentials as formatted text</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const text = `Partner ID: ${credential.partner_id}\nPartner Name: ${credential.partner_name}\n${credential.is_dummy_email ? "Username" : "Email"}: ${loginValue}\nPassword: ${credential.password}`;
                  copy(text, "all");
                }}
                className="w-full h-8 text-xs"
              >
                {copiedField === "all" ? (
                  <><Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />Copied!</>
                ) : (
                  <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy All Credentials</>
                )}
              </Button>
            </div>
          </div> */}
            <div>
            <h3 className="text-[10px] font-semibold text-blue-800 uppercase tracking-wider border-b border-blue-200 pb-0.5 mb-2">
                Quick Copy
              </h3>
              <p className="text-xs text-blue-600 mb-2">Copy all credentials as formatted text</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const text = `Partner ID: ${credential.partner_id}\nPartner Name: ${credential.partner_name}\n${credential.is_dummy_email ? "Username" : "Email"}: ${loginValue}\nPassword: ${credential.password}`;
                  copy(text, "all");
                }}
                className="w-full h-8 text-xs"
              >
                {copiedField === "all" ? (
                  <><Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />Copied!</>
                ) : (
                  <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy All Credentials</>
                )}
              </Button>
            </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ViewCredentialModal;

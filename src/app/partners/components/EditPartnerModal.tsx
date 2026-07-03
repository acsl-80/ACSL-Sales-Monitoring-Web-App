
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, User, Phone, Mail, MapPin, Tag } from "lucide-react";
import { useAuth } from "../../contexts/useAuth";
import { useToast } from "@/components/ui/toast";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";

const clean = (v: string | undefined | null) => {
  const s = (v ?? "").trim();
  return ["n/a", "na", "null", "undefined", "none", "-"].includes(s.toLowerCase()) ? "" : s;
};

interface Organization {
  id: string;
  partner_id: string;
  partner_name: string;
  branch?: string;
  state?: string;
  email?: string;
  contact_person?: string;
  contact_phone?: string;
  alternative_phone?: string;
  address?: string;
  partner_type?: string;
  manually_edited?: boolean;
}

interface Credential {
  username?: string;
  email?: string;
  is_dummy_email?: boolean;
}

interface Props {
  organization: Organization | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedOrg: Organization) => void;
}

const Field = ({
  label,
  icon: Icon,
  error,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1">
    <Label className="text-[11px] font-medium text-gray-600 flex items-center gap-1.5">
      {Icon && <Icon className="h-3 w-3 text-gray-400" />}
      {label}
    </Label>
    {children}
    {error && <p className="text-[11px] text-red-500">{error}</p>}
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-1 mb-3">
      {title}
    </h3>
    {children}
  </div>
);

export default function EditPartnerModal({ organization, isOpen, onClose, onSuccess }: Props) {
  const { supabase } = useAuth();
  const { toast } = useToast();

  const [submitting, setSubmitting] = useState(false);
  const [loadingCred, setLoadingCred] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);

  const [form, setForm] = useState({
    partner_type: "partner",
    contact_person: "",
    contact_phone: "",
    alternative_phone: "",
    email: "",
    address: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen || !organization) return;
    setForm({
      partner_type: clean(organization.partner_type) || "partner",
      contact_person: clean(organization.contact_person),
      contact_phone: clean(organization.contact_phone),
      alternative_phone: clean(organization.alternative_phone),
      email: clean(organization.email),
      address: clean(organization.address),
    });
    setErrors({});
    setCredential(null);
    loadCredential();
  }, [isOpen, organization?.id]);

  const loadCredential = async () => {
    if (!organization?.partner_id) return;
    setLoadingCred(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/manage-credentials?partner_id=${encodeURIComponent(organization.partner_id)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) return; // no credential row is fine; silently ignore
      const result = await res.json().catch(() => null);
      const cred: Credential | null = result?.data ?? null;
      if (!cred) return;
      setCredential(cred);
      if (cred.email && !cred.is_dummy_email) {
        setForm((prev) => ({ ...prev, email: clean(cred.email) }));
      }
    } catch {
      // non-critical
    } finally {
      setLoadingCred(false);
    }
  };

  const setField = (k: string, v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: "" }));
  };

  const isDummyEmail = credential?.is_dummy_email ?? !organization?.email;
  const canEditEmail = isDummyEmail || !credential?.email;

  const handleSubmit = async () => {
    if (!organization) return;

    const payload: Record<string, string> = {};
    const newErrors: Record<string, string> = {};

    const trimType = form.partner_type.trim();
    const trimPerson = form.contact_person.trim();
    const trimPhone = form.contact_phone.trim();
    const trimAltPhone = form.alternative_phone.trim();
    const trimEmail = form.email.trim();
    const trimAddress = form.address.trim();

    if (trimType !== (organization.partner_type ?? "")) payload.partner_type = trimType;
    if (trimPerson !== (organization.contact_person ?? "")) payload.contact_person = trimPerson;
    if (trimPhone !== (organization.contact_phone ?? "")) payload.contact_phone = trimPhone;
    if (trimAltPhone !== (organization.alternative_phone ?? "")) payload.alternative_phone = trimAltPhone;
    if (trimAddress !== (organization.address ?? "")) payload.address = trimAddress;

    if (canEditEmail && trimEmail && trimEmail !== (credential?.email ?? organization.email ?? "")) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
        newErrors.email = "Enter a valid email address";
      } else {
        payload.email = trimEmail;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (Object.keys(payload).length === 0) {
      toast({ variant: "error", title: "No changes to save" });
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/manage-organizations/${organization.id}?action=update-details`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        }
      );
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || result.message || "Update failed");
      }
      toast({ variant: "success", title: "Partner details updated" });
      onSuccess(result.data?.organization ?? { ...organization, ...payload });
      onClose();
    } catch (err: any) {
      toast({ variant: "error", title: "Error", description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (!organization) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[88vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
          <DialogTitle className="text-base font-bold">Edit Partner Details</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {organization.partner_name}
            <span className="ml-2 font-mono text-[11px] text-gray-500">
              {organization.partner_id}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <Section title="Partner">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Partner Type" icon={Tag}>
                <Select value={form.partner_type} onValueChange={(v) => setField("partner_type", v)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partner">Partner</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contact Person" icon={User}>
                <Input
                  value={form.contact_person}
                  onChange={(e) => setField("contact_person", e.target.value)}
                  placeholder="Full name"
                  className="h-9 text-sm"
                />
              </Field>
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Phone Number" icon={Phone}>
                <Input
                  value={form.contact_phone}
                  onChange={(e) => setField("contact_phone", e.target.value)}
                  placeholder="e.g. 08012345678"
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="Alternative Phone" icon={Phone}>
                <Input
                  value={form.alternative_phone}
                  onChange={(e) => setField("alternative_phone", e.target.value)}
                  placeholder="e.g. 08098765432"
                  className="h-9 text-sm"
                />
              </Field>
              {canEditEmail ? (
                <Field label="Email Address" icon={Mail} error={errors.email}>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    placeholder="partner@example.com"
                    className={`h-9 text-sm ${errors.email ? "border-red-500" : ""}`}
                  />
                </Field>
              ) : (
                <Field label="Email Address" icon={Mail}>
                  <Input
                    value={credential?.email ?? organization.email ?? ""}
                    readOnly
                    className="h-9 text-sm bg-gray-100"
                  />
                </Field>
              )}
              <Field label="Street Address" icon={MapPin}>
                <Input
                  value={form.address}
                  onChange={(e) => setField("address", e.target.value)}
                  placeholder="Street address"
                  className="h-9 text-sm"
                />
              </Field>
            </div>
          </Section>

          {loadingCred && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading credential…
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2 shrink-0 bg-gray-50/50">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || loadingCred}
            className="bg-brand hover:bg-brand/90 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1.5" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

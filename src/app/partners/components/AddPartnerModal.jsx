
import { useState, useRef } from "react";
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
import Modal from "@/components/ui/modal";
import { FormGrid, FormFieldWrapper } from "@/components/ui/form-grid";
import { Plus, Trash2, Upload, X, Loader2 } from "lucide-react";
import { lgaAndStates } from "../../constants";
import { useAuth } from "../../contexts/useAuth";
import { useToast } from "@/components/ui/toast";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const nigerianStates = Object.keys(lgaAndStates).sort();

function generatePartnerId(name) {
  const clean = name.toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const prefix = words.map((w) => w[0]).join("").slice(0, 4);
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

function parseStoveCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { rows: [], error: null };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const stoveIdx = header.findIndex((h) => h === "stove_id" || h === "stoveid" || h === "stove id");
  const factoryIdx = header.findIndex((h) => h === "factory");
  const refIdx = header.findIndex((h) => h === "sales_reference" || h === "reference" || h === "ref");
  if (stoveIdx === -1) return { rows: [], error: 'CSV must have a "stove_id" column.' };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const stove_id = cols[stoveIdx] || "";
    if (!stove_id) continue;
    rows.push({
      stove_id,
      factory: factoryIdx !== -1 ? cols[factoryIdx] || "" : "",
      sales_reference: refIdx !== -1 ? cols[refIdx] || "" : "",
    });
  }
  return { rows, error: null };
}

const emptyStove = () => ({ stove_id: "", factory: "", sales_reference: "" });

export default function AddPartnerModal({ isOpen, onClose, onSuccess }) {
  const { supabase } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [csvError, setCsvError] = useState("");

  const [form, setForm] = useState({
    partner_id: "",
    partner_name: "",
    partner_type: "partner",
    email: "",
    contact_person: "",
    contact_phone: "",
    alternative_phone: "",
    address: "",
    state: "",
    branch: "",
  });

  const [stoveRows, setStoveRows] = useState([emptyStove()]);

  const setField = (k, v) => {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      // Auto-generate partner_id when name changes (only if not manually edited)
      if (k === "partner_name" && v && !prev._idManual) {
        next.partner_id = generatePartnerId(v);
      }
      return next;
    });
  };

  const setStoveField = (idx, k, v) => {
    setStoveRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [k]: v };
      return next;
    });
  };

  const addStoveRow = () => setStoveRows((prev) => [...prev, emptyStove()]);
  const removeStoveRow = (idx) => setStoveRows((prev) => prev.filter((_, i) => i !== idx));

  const handleCSV = (e) => {
    setCsvError("");
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows, error } = parseStoveCSV(ev.target.result);
      if (error) { setCsvError(error); return; }
      if (rows.length === 0) { setCsvError("No valid rows found in CSV."); return; }
      // Merge: remove blank rows then append
      setStoveRows((prev) => {
        const existing = prev.filter((r) => r.stove_id.trim());
        return [...existing, ...rows];
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleClose = () => {
    setForm({ partner_id: "", partner_name: "", partner_type: "partner", email: "", contact_person: "", contact_phone: "", alternative_phone: "", address: "", state: "", branch: "" });
    setStoveRows([emptyStove()]);
    setCsvError("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!form.partner_name.trim()) {
      toast({ variant: "error", title: "Partner name is required" });
      return;
    }
    if (!form.partner_id.trim()) {
      toast({ variant: "error", title: "Partner ID is required" });
      return;
    }

    const validStoves = stoveRows.filter((r) => r.stove_id.trim());

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const payload = {
        application_name: "internal-dashboard",
        organization_data: {
          partner_id: form.partner_id.trim(),
          partner_name: form.partner_name.trim(),
          partner_type: form.partner_type || "partner",
          email: form.email.trim() || undefined,
          contact_person: form.contact_person.trim() || undefined,
          contact_phone: form.contact_phone.trim() || undefined,
          alternative_phone: form.alternative_phone.trim() || undefined,
          address: form.address.trim() || undefined,
          state: form.state || undefined,
          branch: form.branch.trim() || undefined,
        },
        stove_ids: validStoves.map((r) => ({
          stove_id: r.stove_id.trim(),
          factory: r.factory.trim() || undefined,
          sales_reference: r.sales_reference.trim() || undefined,
        })),
      };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/external-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to create partner");
      }

      const action = data.data?.organization?.action;
      const stovesCreated = data.data?.summary?.stove_ids_created ?? 0;
      toast({
        variant: "success",
        title: action === "updated" ? "Partner updated" : "Partner created",
        description: stovesCreated > 0 ? `${stovesCreated} stove ID(s) assigned` : undefined,
      });

      handleClose();
      onSuccess?.();
    } catch (err) {
      toast({ variant: "error", title: "Error", description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const filledStoves = stoveRows.filter((r) => r.stove_id.trim()).length;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      size="3xl"
      title="Add Partner"
      subtitle="Creates partner account, credentials, and assigns stove IDs"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-green-600 hover:bg-green-700 text-white min-w-[120px]">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating...</> : "Create Partner"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 py-1">

        {/* ── Partner Information ─────────────────────────────── */}
        <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
          <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-1 mb-3">
            Partner Information
          </h3>
          <FormGrid cols={2}>
            <FormFieldWrapper label="Partner Name *">
              <Input
                value={form.partner_name}
                onChange={(e) => setField("partner_name", e.target.value)}
                placeholder="e.g. Acme Stoves Ltd"
              />
            </FormFieldWrapper>
            <FormFieldWrapper label="Partner ID *">
              <Input
                value={form.partner_id}
                onChange={(e) => setForm((p) => ({ ...p, partner_id: e.target.value, _idManual: true }))}
                placeholder="Auto-generated from name"
              />
            </FormFieldWrapper>
            <FormFieldWrapper label="Partner Type">
              <Select value={form.partner_type} onValueChange={(v) => setField("partner_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="partner">Partner</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                </SelectContent>
              </Select>
            </FormFieldWrapper>
            <FormFieldWrapper label="State">
              <Select value={form.state} onValueChange={(v) => setField("state", v)}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {nigerianStates.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormFieldWrapper>
            <FormFieldWrapper label="Branch">
              <Input value={form.branch} onChange={(e) => setField("branch", e.target.value)} placeholder="e.g. Main Branch" />
            </FormFieldWrapper>
            <FormFieldWrapper label="Address">
              <Input value={form.address} onChange={(e) => setField("address", e.target.value)} placeholder="Street address" />
            </FormFieldWrapper>
          </FormGrid>
        </div>

        {/* ── Contact Information ─────────────────────────────── */}
        <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
          <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-1 mb-3">
            Contact Information
          </h3>
          <FormGrid cols={2}>
            <FormFieldWrapper label="Contact Person">
              <Input value={form.contact_person} onChange={(e) => setField("contact_person", e.target.value)} placeholder="Full name" />
            </FormFieldWrapper>
            <FormFieldWrapper label="Email">
              <Input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="admin@partner.com" />
            </FormFieldWrapper>
            <FormFieldWrapper label="Phone">
              <Input value={form.contact_phone} onChange={(e) => setField("contact_phone", e.target.value)} placeholder="+234..." />
            </FormFieldWrapper>
            <FormFieldWrapper label="Alternative Phone">
              <Input value={form.alternative_phone} onChange={(e) => setField("alternative_phone", e.target.value)} placeholder="+234..." />
            </FormFieldWrapper>
          </FormGrid>
          <p className="text-[11px] text-muted-foreground mt-2">
            If a valid email is provided, the partner logs in with email + password. Otherwise a username-based account is auto-generated.
          </p>
        </div>

        {/* ── Stove IDs ───────────────────────────────────────── */}
        <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
          <div className="flex items-center justify-between border-b border-primary/20 pb-1 mb-3">
            <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">
              Stove IDs {filledStoves > 0 && <span className="ml-1 text-green-600">({filledStoves} added)</span>}
            </h3>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCSV} />
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3 w-3 mr-1" />Upload CSV
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addStoveRow}>
                <Plus className="h-3 w-3 mr-1" />Add Row
              </Button>
            </div>
          </div>

          {csvError && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{csvError}</div>
          )}

          <p className="text-[11px] text-muted-foreground mb-2">
            CSV columns: <code className="bg-muted px-1 rounded">stove_id, factory, sales_reference</code>
          </p>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {/* Header */}
            <div className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 px-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Stove ID</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Factory</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Sales Reference</span>
              <span />
            </div>

            {stoveRows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-center">
                <Input
                  value={row.stove_id}
                  onChange={(e) => setStoveField(idx, "stove_id", e.target.value)}
                  placeholder="STK-0001"
                  className="h-8 text-xs"
                />
                <Input
                  value={row.factory}
                  onChange={(e) => setStoveField(idx, "factory", e.target.value)}
                  placeholder="Factory A"
                  className="h-8 text-xs"
                />
                <Input
                  value={row.sales_reference}
                  onChange={(e) => setStoveField(idx, "sales_reference", e.target.value)}
                  placeholder="REF-001"
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => stoveRows.length > 1 ? removeStoveRow(idx) : setStoveField(idx, "stove_id", "")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Modal>
  );
}

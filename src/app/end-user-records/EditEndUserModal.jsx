import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import adminSalesService from "../services/adminSalesService";
import { isValidNgPhone, NG_PHONE_FORMAT_MESSAGE } from "../utils/salesFormValidation";
import { lgaAndStates } from "../constants";
import { fieldLabel } from "@/lib/saleDictionary";

/**
 * Edit end-user portion of a sale.
 * Visible to super_admin, acsl_agent_manager, partner (row-level gate is in caller).
 */
const EditEndUserModal = ({ open, sale, onClose, onSaved }) => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!sale) {
      setForm(null);
      return;
    }
    const addr = sale.addresses || sale.address || {};
    setForm({
      endUserName: sale.end_user_name || "",
      aka: sale.aka || "",
      phone: sale.phone || "",
      otherPhone: sale.other_phone || "",
      contactPerson: sale.contact_person || "",
      contactPhone: sale.contact_phone || "",
      stateBackup: sale.state_backup || "",
      lgaBackup: sale.lga_backup || "",
      street: addr.street || "",
      city: addr.city || "",
      fullAddress: addr.full_address || "",
      country: addr.country || "Nigeria",
      latitude: addr.latitude ?? null,
      longitude: addr.longitude ?? null,
    });
    setFieldErrors({});
    setError("");
  }, [sale]);

  if (!open || !form) return null;

  const stateList = Object.keys(lgaAndStates).sort();
  const lgaList = form.stateBackup ? lgaAndStates[form.stateBackup] || [] : [];

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => {
      const next = { ...e };
      if (key === "phone" || key === "contactPhone") {
        if (!value || isValidNgPhone(value)) delete next[key];
        else next[key] = NG_PHONE_FORMAT_MESSAGE;
      }
      return next;
    });
  };

  const handleSave = async () => {
    setError("");
    const errs = {};
    if (!form.endUserName.trim()) errs.endUserName = "Required";
    if (!form.contactPerson.trim()) errs.contactPerson = "Required";
    if (!isValidNgPhone(form.phone)) errs.phone = NG_PHONE_FORMAT_MESSAGE;
    if (!isValidNgPhone(form.contactPhone)) errs.contactPhone = NG_PHONE_FORMAT_MESSAGE;
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        endUserName: form.endUserName,
        aka: form.aka,
        phone: form.phone,
        otherPhone: form.otherPhone,
        contactPerson: form.contactPerson,
        contactPhone: form.contactPhone,
        stateBackup: form.stateBackup,
        lgaBackup: form.lgaBackup,
        addressData: {
          fullAddress: form.fullAddress,
          street: form.street,
          city: form.city,
          state: form.stateBackup,
          country: form.country,
          latitude: form.latitude,
          longitude: form.longitude,
        },
      };
      const result = await adminSalesService.updateSale(sale.id, payload);
      if (!result.success) {
        setError(result.error || "Failed to save changes");
        return;
      }
      onSaved?.({
        ...sale,
        end_user_name: form.endUserName,
        aka: form.aka,
        phone: form.phone,
        other_phone: form.otherPhone,
        contact_person: form.contactPerson,
        contact_phone: form.contactPhone,
        state_backup: form.stateBackup,
        lga_backup: form.lgaBackup,
        updated_at: new Date().toISOString(),
        // updated_by_profile is refreshed on next fetch.
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit End User — {sale.transaction_id || sale.stove_serial_no}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>{fieldLabel("end_user_name")} *</Label>
            <Input value={form.endUserName} onChange={(e) => setField("endUserName", e.target.value)} />
            {fieldErrors.endUserName && <p className="text-xs text-red-600 mt-1">{fieldErrors.endUserName}</p>}
          </div>
          <div>
            <Label>{fieldLabel("aka")}</Label>
            <Input value={form.aka} onChange={(e) => setField("aka", e.target.value)} />
          </div>
          <div>
            <Label>{fieldLabel("phone")} *</Label>
            <Input value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
            {fieldErrors.phone && <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>}
          </div>
          <div>
            <Label>{fieldLabel("other_phone")}</Label>
            <Input value={form.otherPhone} onChange={(e) => setField("otherPhone", e.target.value)} />
          </div>
          <div>
            <Label>{fieldLabel("contact_person")} *</Label>
            <Input value={form.contactPerson} onChange={(e) => setField("contactPerson", e.target.value)} />
            {fieldErrors.contactPerson && <p className="text-xs text-red-600 mt-1">{fieldErrors.contactPerson}</p>}
          </div>
          <div>
            <Label>{fieldLabel("contact_phone")} *</Label>
            <Input value={form.contactPhone} onChange={(e) => setField("contactPhone", e.target.value)} />
            {fieldErrors.contactPhone && <p className="text-xs text-red-600 mt-1">{fieldErrors.contactPhone}</p>}
          </div>
          <div>
            <Label>{fieldLabel("state_backup")}</Label>
            <Select value={form.stateBackup || undefined} onValueChange={(v) => { setField("stateBackup", v); setField("lgaBackup", ""); }}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {stateList.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{fieldLabel("lga_backup")}</Label>
            <Select value={form.lgaBackup || undefined} onValueChange={(v) => setField("lgaBackup", v)} disabled={!lgaList.length}>
              <SelectTrigger><SelectValue placeholder="Select LGA" /></SelectTrigger>
              <SelectContent>
                {lgaList.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Street</Label>
            <Input value={form.street} onChange={(e) => setField("street", e.target.value)} />
          </div>
          <div>
            <Label>{fieldLabel("city")}</Label>
            <Input value={form.city} onChange={(e) => setField("city", e.target.value)} />
          </div>
          <div>
            <Label>Country</Label>
            <Input value={form.country} onChange={(e) => setField("country", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>{fieldLabel("full_address")}</Label>
            <Textarea value={form.fullAddress} onChange={(e) => setField("fullAddress", e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-[#4a5d0f] hover:bg-[#3a4a0c] text-white">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditEndUserModal;

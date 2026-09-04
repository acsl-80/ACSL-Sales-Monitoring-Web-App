import { useMemo, useState } from "react";
import { dataCenterCorrections, dataCenterSales, DataCenterError } from "../../lib/client";
import { EDITABLE, byKey } from "./lib/saleFields";
import { Loader2, Check, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Fix the record.
 *
 * Disputed fields first, the rest behind "show more". The save goes through
 * the sales app's own `update-sale`, which needs the four required fields on
 * every call, so they are always sent, prefilled from the sale; then the
 * episode moves to `fixed` with the rep's note. Two requests, in that order,
 * so a refused edit never leaves an episode claiming to be fixed.
 */

const PREVIOUS_STOVES = [
  { value: "charcoal", label: "Charcoal" },
  { value: "wood_stove", label: "Wood (3 stone)" },
  { value: "other", label: "Other" },
];

const REQUIRED = ["end_user_name", "contact_person", "phone", "contact_phone"];

function toForm(sale) {
  const f = {};
  for (const field of EDITABLE) {
    const v = sale?.[field.key];
    f[field.key] = field.key === "heat_retention_device" ? Boolean(v) : v == null ? "" : String(v);
  }
  return f;
}

function Control({ field, value, onChange, disputed, input }) {
  const id = `fix-${field.key}`;
  const base = "mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2";
  const tone = disputed
    ? "border-amber-500 bg-amber-50 focus:ring-amber-300"
    : "border-gray-300 bg-white focus:ring-(--dc-accent)/30";
  return (
    <div>
      <label htmlFor={id} className={`block text-xs font-medium uppercase tracking-wide ${disputed ? "text-amber-900" : "text-gray-600"}`}>
        {field.label}
        {disputed && (
          <span aria-hidden className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900">
            disputed
          </span>
        )}
      </label>
      {field.key === "heat_retention_device" ? (
        <label className="mt-1 inline-flex items-center gap-2 text-sm text-gray-800">
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Included
        </label>
      ) : field.key === "previous_stove_type" ? (
        <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={`${base} ${tone}`}>
          <option value="">Not recorded</option>
          {PREVIOUS_STOVES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.key === "sales_date" ? "date" : field.key === "amount" || field.key === "total_paid" || field.key === "pot_quantity" ? "number" : "text"}
          inputMode={field.key === "phone" || field.key === "other_phone" || field.key === "contact_phone" ? "tel" : undefined}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} ${tone} ${input ?? ""}`}
        />
      )}
    </div>
  );
}

export default function SaleEditPanel({ saleId, sale, disputed, canEditSale, onlyNote = false, onSaved }) {
  const initial = useMemo(() => toForm(sale), [sale]);
  const [form, setForm] = useState(initial);
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const disputedFields = EDITABLE.filter((f) => disputed.has(f.key));
  // Money is offered only when the send-back disputes it: update-sale keeps
  // total_paid and payment_status coherent with the amount, so a stray edit
  // to the amount rewrites what was paid.
  const otherFields = EDITABLE.filter((f) => !disputed.has(f.key) && f.group !== "money");
  const changed = EDITABLE.filter((f) => String(form[f.key] ?? "") !== String(initial[f.key] ?? ""));

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setError(null);
    if (!note.trim()) {
      setError("Say what you changed and how you know before sending it for review.");
      return;
    }
    setBusy(true);
    try {
      if (changed.length > 0 && !onlyNote) {
        const payload = {};
        // The four required fields, and the four update-sale used to write
        // unconditionally: sent every time, as the host's own form sends them,
        // so an older deployment of the function nulls nothing.
        for (const key of [...REQUIRED, "aka", "other_phone", "state_backup", "lga_backup"]) {
          payload[byKey[key].payload] = form[key] === "" ? null : form[key];
        }
        for (const f of changed) {
          if (f.key === "full_address") payload.addressData = { fullAddress: form.full_address };
          else if (f.payload) payload[f.payload] = form[f.key] === "" ? null : form[f.key];
        }
        await dataCenterSales.updateSale(saleId, payload);
      }
      await dataCenterCorrections.fix(saleId, note.trim());
      onSaved?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not save.");
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-amber-500 bg-white shadow-sm">
      <header className="border-b border-gray-100 bg-amber-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">Fix the record</h2>
        <p className="mt-0.5 text-xs text-gray-600">
          {canEditSale
            ? "Disputed fields first. Saved through the sales app's own edit path, and every change is logged on the sale."
            : "Your sales app role cannot edit a sale. You can still say what was done and send it for review."}
        </p>
      </header>
      <div className="space-y-3 p-4">
        {canEditSale && !onlyNote && disputedFields.map((f) => (
          <Control key={f.key} field={f} value={form[f.key]} onChange={(v) => set(f.key, v)} disputed />
        ))}
        {canEditSale && !onlyNote && otherFields.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setMore((m) => !m)}
              className="inline-flex items-center gap-1 text-xs font-medium text-(--dc-accent)"
            >
              {more ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {more ? "Hide the other fields" : `Show ${otherFields.length} more fields`}
            </button>
            {more && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {otherFields.map((f) => (
                  <Control key={f.key} field={f} value={form[f.key]} onChange={(v) => set(f.key, v)} />
                ))}
              </div>
            )}
          </div>
        )}
        <div>
          <label htmlFor="fix-note" className="block text-xs font-medium uppercase tracking-wide text-gray-600">
            What did you change, and how do you know
          </label>
          <textarea
            id="fix-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What did you do? The call centre reads this before ringing again."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--dc-accent)/30"
          />
        </div>
        {changed.length > 0 && (
          <p className="text-xs text-gray-600">
            Changing: {changed.map((f) => f.label.toLowerCase()).join(", ")}.
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-(--dc-accent) px-4 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {changed.length > 0 && canEditSale && !onlyNote ? "Save and send for review" : "Send for review"}
          </button>
        </div>
      </div>
    </section>
  );
}

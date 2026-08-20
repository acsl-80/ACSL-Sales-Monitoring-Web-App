import { useState } from "react";
import { Loader2, PenLine, X } from "lucide-react";

/**
 * One record, typed rather than uploaded.
 *
 * A file is the normal case and it is not the only one. A receipt turns up on
 * its own, or a rejected row needs re-keying, and building a one-line
 * spreadsheet to import it is a workaround people do not perform: they write it
 * on a sticky note instead, and it never reaches the system at all.
 *
 * It submits as a batch of one and goes through the same validator, the same
 * stock check and the same exceptions queue as a file. The field names below
 * are header aliases the importer already understands, so nothing here needs a
 * second definition of what a valid record is.
 */

const FIELDS = [
  { key: "stove_serial_no", label: "Stove serial number", required: true, width: "sm:col-span-2" },
  // A row with no name at all is refused. First or last will do, so the
  // required mark sits on the first of them.
  { key: "first_name", label: "First name", required: true },
  { key: "last_name", label: "Last name" },
  { key: "phone", label: "Phone number", required: true, placeholder: "08012345678" },
  { key: "other_phone", label: "Other phone" },
  { key: "sales_date", label: "Sale date", required: true, type: "date" },
  { key: "amount", label: "Amount", required: true, type: "number", placeholder: "25000" },
  { key: "amount_received", label: "Amount received", type: "number" },
  { key: "state", label: "State", required: true },
  { key: "lga", label: "LGA", required: true },
  { key: "address", label: "Address", required: true, width: "sm:col-span-2" },
];

export default function ManualEntry({ onSubmit, onCancel, busy, partnerName }) {
  const [values, setValues] = useState({});

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    // Drop the blanks rather than sending empty strings. An absent optional
    // field and one typed as "" mean the same thing to a person and different
    // things to a validator.
    const record = {};
    for (const [k, v] of Object.entries(values)) {
      const trimmed = String(v ?? "").trim();
      if (trimmed) record[k] = trimmed;
    }
    onSubmit(record);
  };

  return (
    <form onSubmit={submit} className="border-b border-gray-100 bg-[#fafafa] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PenLine className="h-4 w-4 text-[#4a5d0f]" />
        <span className="text-sm font-semibold text-gray-900">Type one record</span>
        {partnerName && <span className="text-sm text-gray-500">for {partnerName}</span>}
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.width ?? ""}>
            <label
              htmlFor={`dc-manual-${f.key}`}
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              {f.label}
              {/* Hidden from the accessibility tree: aria-required on the
                  input already carries the meaning, and a screen reader
                  announcing "star" after every other field name is noise. */}
              {f.required && (
                <span aria-hidden="true" className="text-red-600"> *</span>
              )}
            </label>
            <input
              id={`dc-manual-${f.key}`}
              type={f.type ?? "text"}
              // aria-required rather than required. The validator is the one
              // authority on what a valid record is, and it enforces rules the
              // form cannot state: the phone format, and amount received never
              // exceeding the amount.
              aria-required={f.required ? "true" : undefined}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#4a5d0f] focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#4a5d0f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3d4d0c] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
          Stage this record
        </button>
        <p className="text-xs text-gray-500">
          Checked against stock like any other row. Committing is a separate step.
        </p>
      </div>
    </form>
  );
}

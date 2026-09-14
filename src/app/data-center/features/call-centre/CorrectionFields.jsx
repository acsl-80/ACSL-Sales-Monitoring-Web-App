import { Phone } from "lucide-react";

/** The record's own correction columns, as opposed to registry questions. Real columns, because reporting groups by them. */
const CORRECTION_FIELDS = [
  { key: "corrected_phone", label: "Corrected telephone number", type: "tel" },
  { key: "corrected_alt_phone", label: "Corrected other telephone number", type: "tel" },
  { key: "corrected_end_user_name", label: "Corrected customer name", type: "text" },
  { key: "corrected_address", label: "Corrected address", type: "text" },
  { key: "corrected_state", label: "Corrected state", type: "text" },
  { key: "corrected_lga", label: "Corrected LGA", type: "text" },
  { key: "ward", label: "Ward", type: "text" },
  { key: "landmark", label: "Landmark", type: "text" },
  { key: "stated_serial", label: "Serial number as stated by the user", type: "text" },
];

export function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}

export default function CorrectionFields({ values, record, canEdit, onChange }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <Phone className="h-3.5 w-3.5" /> What the call corrected
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CORRECTION_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              type={f.type}
              disabled={!canEdit}
              value={values[f.key] ?? record?.[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50"
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

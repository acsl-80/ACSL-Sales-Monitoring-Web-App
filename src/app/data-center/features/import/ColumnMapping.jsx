import { useMemo, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { plural } from "../../lib/plural";
import { fieldLabel, payloadLabel } from "@/lib/saleDictionary";
import { AlertTriangle, ArrowRight, CheckCircle2, X } from "lucide-react";

/**
 * The step between choosing a file and staging it.
 *
 * An unrecognised column used to be dropped in silence. A workbook whose phone
 * column was headed "Mobile No." imported cleanly with no phone numbers in it,
 * and the first anyone knew was the call centre having nobody to ring.
 *
 * So the file now says what it understood before anything is written. It
 * appears only when there is something to decide: a file whose headers are all
 * recognised goes straight through, because a confirmation nobody can fail is
 * a click that trains people to click.
 */

/**
 * Field keys read as English, from the sale dictionary.
 *
 * The importer's own key on the left, the paper User Agreement's wording on
 * the right, so this step names a field the way every other screen does.
 */
const FIELD_LABELS = {
  stoveSerialNo: fieldLabel("stove_serial_no"),
  firstName: fieldLabel("end_user_first_name"),
  lastName: fieldLabel("end_user_surname"),
  endUserName: fieldLabel("end_user_name"),
  phone: fieldLabel("phone"),
  otherPhone: fieldLabel("other_phone"),
  salesDate: fieldLabel("sales_date"),
  amount: fieldLabel("amount"),
  amountReceived: fieldLabel("first_payment"),
  city: fieldLabel("city"),
  salesAgentName: fieldLabel("sales_agent_name"),
  state: fieldLabel("state_backup"),
  lga: fieldLabel("lga_backup"),
  fullAddress: fieldLabel("full_address"),
  contactPerson: fieldLabel("contact_person"),
  contactPhone: fieldLabel("contact_phone"),
  aka: fieldLabel("aka"),
};

// Every mappable field has a word: the table above for the sheet's own
// names, the dictionary for the rest, so no key reaches the reader raw.
const label = (field) => FIELD_LABELS[field] ?? payloadLabel(field);

export default function ColumnMapping({ file, inspection, onCancel, onConfirm, busy }) {
  const [mapping, setMapping] = useState({});

  // Which required fields are still unfed, counting what the operator has just
  // mapped. Recomputed as they choose, so the warning clears in front of them
  // rather than after a failed attempt.
  const stillMissing = useMemo(() => {
    const fed = new Set(inspection.recognised.map((r) => r.field));
    for (const field of Object.values(mapping)) if (field) fed.add(field);
    if (fed.has("firstName") || fed.has("lastName")) fed.add("endUserName");
    return inspection.missingRequired.filter((f) => !fed.has(f));
  }, [inspection, mapping]);

  const overCap = file.rowCount > inspection.maxRows;

  return (
    <div className="border-b border-gray-100 bg-(--dc-surface-muted) px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">
          What this file looks like
        </span>
        <span className="text-sm text-gray-500">
          {file.name} &middot; {plural(file.rowCount, "row")} of at most{" "}
          {inspection.maxRows.toLocaleString()}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>

      {overCap && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          This file has {file.rowCount.toLocaleString()} rows and the limit is{" "}
          {inspection.maxRows.toLocaleString()}. Split it and upload the parts.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-(--dc-accent)" />
            Understood ({inspection.recognised.length})
          </p>
          {inspection.recognised.length === 0 ? (
            <p className="text-sm text-gray-500">None of these headers are recognised.</p>
          ) : (
            <ul className="space-y-1 text-sm text-gray-700">
              {inspection.recognised.map((r) => (
                <li key={r.header} className="flex items-center gap-1.5">
                  <span className="truncate">{r.header}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" />
                  <span className="truncate text-gray-500">{label(r.field)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Not recognised ({inspection.unrecognised.length})
          </p>
          {inspection.unrecognised.length === 0 ? (
            <p className="text-sm text-gray-500">Every column was understood.</p>
          ) : (
            <ul className="space-y-2">
              {inspection.unrecognised.map((header) => (
                <li key={header} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={header}>
                    {header}
                  </span>
                  <div className="w-full shrink-0 sm:w-44">
                    <SearchableSelect
                      ariaLabel={`Map column ${header}`}
                      value={mapping[header] ?? ""}
                      onChange={(next) =>
                        setMapping((m) => ({ ...m, [header]: next }))
                      }
                      placeholder="Ignore this column"
                      searchPlaceholder="Type part of a field name"
                      emptyLabel="No field matches that"
                      pinned={{ value: "", label: "Ignore this column" }}
                      options={inspection.mappableFields.map((f) => ({
                        value: f,
                        label: label(f),
                      }))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {stillMissing.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Nothing feeds {stillMissing.map(label).join(", ")}. Every row will be
          rejected for the missing value unless a column above is mapped to it.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || overCap}
          onClick={() => onConfirm(mapping)}
          className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
        >
          Stage and check
        </button>
        <p className="text-xs text-gray-500">
          Staging writes nothing to the sales app. Committing is a separate step.
        </p>
      </div>
    </div>
  );
}

import { useMemo } from "react";

/**
 * The sale, as it appears on a receipt.
 *
 * The fields and their names come from the sales app's own create form
 * (`createInitialFormData` in `salesFormUtils.js`), because a record typed
 * here has to be the same record typed there. Where this differs it is by
 * subtraction, never by invention: the stove photo, the agreement document and
 * the signature are file uploads from paper and are not asked for yet, which
 * production already tolerates - `calculate_sale_status` still demands them
 * and the Sell Stove form stopped doing so, which is why 30 of 38 production
 * sales read "incomplete".
 *
 * The order is the order a receipt reads, not the order the database stores.
 * A typist works top to bottom with paper beside them, and every jump back up
 * the page is a chance to put a number in the wrong box.
 */

const INPUT =
  "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

/**
 * What has to be there before this can be called finished.
 *
 * The same list `normalizeRow` enforces on the server. Held here as well so
 * the typist is told before they press the button rather than after, and the
 * server still decides: this is a courtesy, not the rule.
 */
export const REQUIRED = [
  "endUserName",
  "phone",
  "salesDate",
  "amount",
  "state",
  "lga",
  "fullAddress",
];

const SECTIONS = [
  {
    key: "buyer",
    title: "Who bought it",
    fields: [
      { key: "endUserName", label: "Full name", required: true,
        help: "As written on the receipt. First and last name together." },
      { key: "aka", label: "Also known as", help: "A nickname the caller might be asked for." },
      { key: "phone", label: "Phone number", required: true, type: "tel",
        help: "Any format. 08012345678, +234 801 234 5678 and 8012345678 all work." },
      { key: "otherPhone", label: "Another number", type: "tel",
        help: "Optional. Tried when the first one does not answer." },
      { key: "contactPerson", label: "Contact person",
        help: "Only if somebody else is the point of contact. Left empty, the buyer is." },
      { key: "contactPhone", label: "Contact phone", type: "tel" },
    ],
  },
  {
    key: "where",
    title: "Where they are",
    fields: [
      { key: "state", label: "State", required: true },
      { key: "lga", label: "Local government area", required: true,
        help: "On the receipt under the address." },
      { key: "fullAddress", label: "Residential address", required: true, wide: true,
        help: "Enough detail for a field agent to find the house." },
    ],
  },
  {
    key: "sale",
    title: "The sale",
    fields: [
      { key: "salesDate", label: "Date of sale", required: true, type: "date" },
      { key: "amount", label: "Sale amount", required: true, type: "number",
        help: "Digits only. No naira sign, no commas." },
      { key: "amountReceived", label: "Amount received", type: "number",
        help: "Leave empty if nothing has been paid yet, rather than typing 0." },
    ],
  },
];

function Field({ field, value, onChange, invalid, disabled }) {
  const id = `wb-${field.key}`;
  return (
    <div className={field.wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {field.label}
        {field.required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type={field.type ?? "text"}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(field.key, e.target.value)}
        aria-invalid={invalid || undefined}
        className={`${INPUT} ${invalid ? "border-red-400" : ""}`}
      />
      {/* The help sits under the input rather than in a tooltip: a typist with
          paper in one hand is not going to hover anything. */}
      {field.help && <p className="mt-1 text-xs text-gray-600">{field.help}</p>}
    </div>
  );
}

export default function SaleForm({ values, onChange, disabled, showMissing }) {
  const missing = useMemo(
    () => new Set(REQUIRED.filter((k) => !String(values[k] ?? "").trim())),
    [values],
  );

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => (
        <section key={section.key}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
            {section.title}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={onChange}
                disabled={disabled}
                invalid={showMissing && missing.has(field.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Which required fields are still empty, for the caller's own messaging. */
export function missingFields(values) {
  return REQUIRED.filter((k) => !String(values?.[k] ?? "").trim());
}

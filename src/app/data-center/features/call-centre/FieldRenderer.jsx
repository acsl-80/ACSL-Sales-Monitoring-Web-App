/**
 * Renders one question from its registry definition.
 *
 * This component is the whole reason adding a question is data entry. It knows
 * about input TYPES, never about specific questions. Nothing here names
 * "purchase price" or "baseline stove", so a supervisor inserting a row into
 * field_defs gets a working, validated input on the next page load with no
 * release and no client change.
 *
 * The one thing that is a code change: a new input TYPE. That is deliberate.
 * A type needs a renderer, and pretending otherwise would mean silently
 * dropping questions the form cannot draw.
 */

const INPUT_CLASS =
  "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-primary) focus:outline-none disabled:bg-gray-50 disabled:text-gray-500";

/**
 * Should this question be shown, given the rest of the record?
 *
 * The same rule the server applies on write. Keeping both is not duplication
 * for its own sake: the server's copy is the one that counts, and this one
 * exists so the agent is not asked something that would then be refused.
 */
export function isFieldVisible(field, values) {
  if (!field.visible_when) return true;
  const { field: dependsOn, in: allowed } = field.visible_when;
  if (!dependsOn || !Array.isArray(allowed)) return true;
  return allowed.includes(String(values[dependsOn] ?? ""));
}

export default function FieldRenderer({ field, value, options, disabled, onChange }) {
  const id = `dc-field-${field.key}`;
  const common = {
    id,
    disabled,
    className: INPUT_CLASS,
    "aria-required": field.is_required || undefined,
  };

  let control;
  switch (field.input_type) {
    case "textarea":
      control = (
        <textarea
          {...common}
          rows={3}
          value={value ?? ""}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
      break;

    case "number":
      control = (
        <input
          {...common}
          type="number"
          value={value ?? ""}
          min={field.validation?.min}
          max={field.validation?.max}
          onChange={(e) => onChange(field.key, e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
      break;

    case "date":
      control = (
        <input
          {...common}
          type="date"
          value={value ?? ""}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
      break;

    case "boolean":
      control = (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={Boolean(value)}
            onChange={(e) => onChange(field.key, e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-(--dc-primary) focus:ring-(--dc-primary)"
          />
          Yes
        </label>
      );
      break;

    case "select":
      control = (
        <select
          {...common}
          value={value ?? ""}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          <option value="">Not answered</option>
          {(options ?? []).map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;

    case "multiselect":
      control = (
        <div className="flex flex-wrap gap-1.5">
          {(options ?? []).map((o) => {
            const chosen = Array.isArray(value) && value.includes(o.value);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const current = Array.isArray(value) ? value : [];
                  onChange(
                    field.key,
                    chosen ? current.filter((v) => v !== o.value) : [...current, o.value],
                  );
                }}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  chosen
                    ? "border-(--dc-primary) bg-(--dc-primary)/10 text-(--dc-primary)"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                } disabled:opacity-50`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
      break;

    case "computed":
      // Derived elsewhere, shown for context, never editable.
      control = (
        <p className="rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-600">
          {value ?? "—"}
        </p>
      );
      break;

    default:
      control = (
        <input
          {...common}
          type="text"
          value={value ?? ""}
          maxLength={field.validation?.maxLength ?? undefined}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {field.label}
        {field.is_required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {control}
      {field.help_text && (
        <p className="mt-1 text-xs text-gray-500">{field.help_text}</p>
      )}
    </div>
  );
}

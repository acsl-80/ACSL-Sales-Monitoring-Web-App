import { useEffect, useRef, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus, X } from "lucide-react";

/**
 * Typed editors for the two settings that are maps (slice 8).
 *
 * `assignment.batch_size_by_partner` is `{ organization_id: number }` and
 * `import.model_map` is `{ sheet spelling: payment model name }`. Both were a
 * raw JSON box, which meant pasting a uuid by hand for the first and spelling
 * a model's name exactly for the second. Here the partner and the model are
 * picked from the lists the module already reads (`record_facets`), and the
 * value saved is the same shape the server reads today; nothing about how
 * the engine or the import consumes them changes.
 *
 * Rows live here as a list with stable ids while the person types, and the
 * object is handed back only when every key is present and unique. Building
 * the object on every keystroke would fold two rows into one the moment a
 * spelling matched another, under the person's cursor. `onChange(next, error)`:
 * `next` is the object or null, `error` a sentence when Save must wait.
 */
const FIELD =
  "rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

let seq = 0;
const rowsOf = (value) => Object.entries(value ?? {}).map(([k, v]) => ({ id: ++seq, k, v }));

/** Local rows that follow the stored value when it changes from outside (save, reset). */
function useRows(value) {
  const asText = JSON.stringify(value ?? {});
  const [rows, setRows] = useState(() => rowsOf(value));
  const seen = useRef(asText);
  useEffect(() => {
    if (seen.current !== asText) {
      seen.current = asText;
      setRows(rowsOf(value));
    }
  }, [asText, value]);
  return [rows, setRows];
}

function Remove({ onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded p-1 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function Add({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-(--dc-accent) px-2.5 py-1 text-xs font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-40"
    >
      <Plus className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

/** What stops a list of rows becoming a map: a blank key, a repeated key, a bad value. */
function problemOf(rows, { blankKey, dupKey, badValue }) {
  const keys = rows.map((r) => r.k.trim());
  if (keys.some((k) => !k)) return blankKey;
  if (new Set(keys).size !== keys.length) return dupKey;
  if (rows.some((r) => !badValue.ok(r.v))) return badValue.say;
  return null;
}

function publish(rows, onChange, rules) {
  const error = problemOf(rows, rules);
  onChange(error ? null : Object.fromEntries(rows.map((r) => [r.k.trim(), r.v])), error);
}

/** Partner to batch size. `partners` is `{ id, name }[]`. */
export function PartnerSizeEditor({ id, value, partners, disabled, onChange }) {
  const [rows, setRows] = useRows(value);
  const rules = {
    blankKey: "Choose a partner for every row before saving.",
    dupKey: "A partner is listed twice; keep one row per partner.",
    badValue: {
      ok: (v) => Number.isInteger(v) && v >= 1,
      say: "A batch size is a whole number of at least 1.",
    },
  };
  const update = (next) => {
    setRows(next);
    publish(next, onChange, rules);
  };
  const taken = new Set(rows.map((r) => r.k));
  const nameOf = (orgId) =>
    partners.find((p) => p.id === orgId)?.name ?? `${orgId.slice(0, 8)}… (not in the partner list)`;
  return (
    <div className="space-y-1.5" data-typed-editor={id}>
      {rows.length === 0 && (
        <p className="text-xs text-gray-500">
          No partner has its own batch size; every partner takes the default.
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`${id}-partner-${r.id}`} className="sr-only">
              Partner
            </label>
            <SearchableSelect
              id={`${id}-partner-${r.id}`}
              ariaLabel="Partner"
              value={r.k}
              disabled={disabled}
              placeholder="Choose a partner"
              searchPlaceholder="Type part of a partner's name"
              emptyLabel="No partner matches that"
              options={[
                { value: r.k, label: nameOf(r.k) },
                ...partners
                  .filter((p) => p.id !== r.k && !taken.has(p.id))
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(nextId) => update(rows.map((x, j) => (j === i ? { ...x, k: nextId } : x)))}
            />
          </div>
          <label htmlFor={`${id}-size-${r.id}`} className="text-xs text-gray-600">
            Batch size
          </label>
          <input
            id={`${id}-size-${r.id}`}
            type="number"
            min={1}
            step={1}
            value={r.v}
            disabled={disabled}
            onChange={(e) =>
              update(
                rows.map((x, j) =>
                  j === i ? { ...x, v: e.target.value === "" ? "" : Number(e.target.value) } : x,
                ),
              )
            }
            className={`${FIELD} w-24 tabular-nums`}
          />
          <Remove
            disabled={disabled}
            label={`Remove ${nameOf(r.k)}`}
            onClick={() => update(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {!disabled && (
        <Add
          disabled={partners.every((p) => taken.has(p.id))}
          onClick={() => {
            const free = partners.find((p) => !taken.has(p.id));
            if (free) update([...rows, { id: ++seq, k: free.id, v: 20 }]);
          }}
        >
          Add a partner
        </Add>
      )}
    </div>
  );
}

/** Sheet spelling to payment model name. `models` is `{ id, name }[]`; the value saved is the name. */
export function ModelMapEditor({ id, value, models, disabled, onChange }) {
  const [rows, setRows] = useRows(value);
  const names = models.map((m) => m.name);
  const rules = {
    blankKey: "Type what the sheet says for every row before saving.",
    dupKey: "Two rows carry the same spelling; keep one row per spelling.",
    badValue: {
      ok: (v) => typeof v === "string" && v.length > 0,
      say: "Choose a model for every spelling.",
    },
  };
  const update = (next) => {
    setRows(next);
    publish(next, onChange, rules);
  };
  return (
    <div className="space-y-1.5" data-typed-editor={id}>
      {rows.length === 0 && (
        <p className="text-xs text-gray-500">
          No spellings mapped; a sheet has to name a model exactly as the models page does.
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-spelling-${r.id}`} className="text-xs text-gray-600">
            Sheet says
          </label>
          <input
            id={`${id}-spelling-${r.id}`}
            type="text"
            value={r.k}
            disabled={disabled}
            onChange={(e) =>
              update(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))
            }
            className={`${FIELD} w-44`}
          />
          <span className="text-xs text-gray-500">means</span>
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`${id}-model-${r.id}`} className="sr-only">
              Payment model
            </label>
            <SearchableSelect
              id={`${id}-model-${r.id}`}
              ariaLabel="Payment model"
              value={r.v}
              disabled={disabled}
              placeholder="Choose a model"
              searchPlaceholder="Type part of a model's name"
              emptyLabel="No model matches that"
              options={[
                ...(r.v && !names.includes(r.v)
                  ? [{ value: r.v, label: `${r.v} (not an active model)` }]
                  : []),
                ...names.map((n) => ({ value: n, label: n })),
              ]}
              onChange={(next) => update(rows.map((x, j) => (j === i ? { ...x, v: next } : x)))}
            />
          </div>
          <Remove
            disabled={disabled}
            label={`Remove ${r.k || "this spelling"}`}
            onClick={() => update(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {!disabled && (
        <Add
          disabled={names.length === 0}
          onClick={() => update([...rows, { id: ++seq, k: "", v: names[0] ?? "" }])}
        >
          Add a spelling
        </Add>
      )}
    </div>
  );
}

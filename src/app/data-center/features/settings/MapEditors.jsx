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
 * Each editor takes the parsed object and hands back the next object; the
 * row that owns the setting turns it back into the JSON the save expects.
 */
const FIELD =
  "rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

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

/** Partner to batch size. `partners` is `{ id, name }[]`. */
export function PartnerSizeEditor({ id, value, partners, disabled, onChange }) {
  const entries = Object.entries(value ?? {});
  const taken = new Set(entries.map(([k]) => k));
  const nameOf = (orgId) => partners.find((p) => p.id === orgId)?.name ?? `${orgId.slice(0, 8)}… (not in the partner list)`;
  const set = (next) => onChange(Object.fromEntries(next));
  return (
    <div className="space-y-1.5" data-typed-editor={id}>
      {entries.length === 0 && (
        <p className="text-xs text-gray-500">No partner has its own batch size; every partner takes the default.</p>
      )}
      {entries.map(([orgId, size], i) => (
        <div key={orgId} className="flex flex-wrap items-center gap-2">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`${id}-partner-${i}`} className="sr-only">Partner</label>
            <SearchableSelect
              id={`${id}-partner-${i}`}
              ariaLabel="Partner"
              value={orgId}
              disabled={disabled}
              placeholder="Choose a partner"
              searchPlaceholder="Type part of a partner's name"
              emptyLabel="No partner matches that"
              options={[
                { value: orgId, label: nameOf(orgId) },
                ...partners.filter((p) => p.id !== orgId && !taken.has(p.id)).map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(nextId) => set(entries.map(([k, v], j) => (j === i ? [nextId, v] : [k, v])))}
            />
          </div>
          <label htmlFor={`${id}-size-${i}`} className="text-xs text-gray-600">Batch size</label>
          <input
            id={`${id}-size-${i}`}
            type="number"
            min={1}
            value={size}
            disabled={disabled}
            onChange={(e) => set(entries.map(([k, v], j) => (j === i ? [k, Number(e.target.value)] : [k, v])))}
            className={`${FIELD} w-24 tabular-nums`}
          />
          <Remove disabled={disabled} label={`Remove ${nameOf(orgId)}`} onClick={() => set(entries.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!disabled && (
        <Add
          disabled={partners.every((p) => taken.has(p.id))}
          onClick={() => {
            const free = partners.find((p) => !taken.has(p.id));
            if (free) set([...entries, [free.id, 20]]);
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
  const entries = Object.entries(value ?? {});
  const set = (next) => onChange(Object.fromEntries(next));
  const names = models.map((m) => m.name);
  return (
    <div className="space-y-1.5" data-typed-editor={id}>
      {entries.length === 0 && (
        <p className="text-xs text-gray-500">No spellings mapped; a sheet has to name a model exactly as the models page does.</p>
      )}
      {entries.map(([spelling, modelName], i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-spelling-${i}`} className="text-xs text-gray-600">Sheet says</label>
          <input
            id={`${id}-spelling-${i}`}
            type="text"
            value={spelling}
            disabled={disabled}
            onChange={(e) => set(entries.map(([k, v], j) => (j === i ? [e.target.value, v] : [k, v])))}
            className={`${FIELD} w-44`}
          />
          <span className="text-xs text-gray-500">means</span>
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`${id}-model-${i}`} className="sr-only">Payment model</label>
            <SearchableSelect
              id={`${id}-model-${i}`}
              ariaLabel="Payment model"
              value={modelName}
              disabled={disabled}
              placeholder="Choose a model"
              searchPlaceholder="Type part of a model's name"
              emptyLabel="No model matches that"
              options={[
                ...(names.includes(modelName) ? [] : [{ value: modelName, label: `${modelName} (not an active model)` }]),
                ...names.map((n) => ({ value: n, label: n })),
              ]}
              onChange={(next) => set(entries.map(([k, v], j) => (j === i ? [k, next] : [k, v])))}
            />
          </div>
          <Remove disabled={disabled} label={`Remove ${spelling || "this spelling"}`} onClick={() => set(entries.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!disabled && (
        <Add disabled={names.length === 0} onClick={() => set([...entries, ["", names[0] ?? ""]])}>
          Add a spelling
        </Add>
      )}
    </div>
  );
}

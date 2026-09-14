import { useCallback, useEffect, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dataCenterAdmin, dataCenterClient, DataCenterError } from "../../lib/client";
import { PartnerSizeEditor, ModelMapEditor } from "./MapEditors";
import { Loader2, SlidersHorizontal, Check, RotateCcw } from "lucide-react";

/**
 * The numbers every rule reads, edited where they can be seen.
 *
 * `workflow_config` has held these since the first migration and the module
 * rule is that thresholds are never hard-coded. That was only ever half true:
 * nothing hard-coded them, and nothing could change them either, so twenty was
 * as fixed as if it had been written into the function.
 *
 * Values are jsonb, which is why the input type comes from the value already
 * stored rather than from a table of key names here. A list of keys would be a
 * second definition of the settings, and it would go stale the first time one
 * was added by migration.
 */

const FIELD_CLASS =
  "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm tabular-nums focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

/** Group by the prefix the keys already use, so related settings sit together. */
const groupOf = (key) => (key.includes(".") ? key.split(".")[0] : "general");

const GROUP_LABEL = {
  assignment: "Assignment",
  import: "Import",
  metrics: "Dashboards",
  reconciliation: "Reconciliation",
  general: "General",
};

/** A draft that is not valid JSON yet reads as an empty map to the typed editors. */
function safeParse(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** What kind of control the stored value asks for. */
function kindOf(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  return "json";
}

/**
 * Two map-shaped settings get a typed editor (slice 8): a partner picker and
 * a number, a sheet spelling and a model picker. The value saved is the same
 * shape the server reads; only the way it is typed changes.
 */
const TYPED = {
  "assignment.batch_size_by_partner": "partners",
  "import.model_map": "models",
};

function Row({ setting, canEdit, onSaved, onError, facets }) {
  const kind = kindOf(setting.value);
  const typed = TYPED[setting.key];
  const asText = kind === "json" ? JSON.stringify(setting.value) : String(setting.value);
  const [draft, setDraft] = useState(asText);
  const [busy, setBusy] = useState(false);
  /** A typed editor's reason Save must wait (a blank or repeated key); null when the rows make a map. */
  const [typedError, setTypedError] = useState(null);
  /** Bumped by Discard so a typed editor remounts from the stored value. */
  const [resetSeq, setResetSeq] = useState(0);
  const onTyped = (next, error) => {
    setTypedError(error ?? null);
    if (!error) setDraft(JSON.stringify(next));
  };
  const discard = () => {
    setDraft(asText);
    setTypedError(null);
    setResetSeq((n) => n + 1);
  };

  useEffect(() => setDraft(asText), [asText]);

  const dirty = draft !== asText;

  const save = async () => {
    let parsed;
    if (kind === "number") {
      parsed = Number(draft);
      if (!Number.isFinite(parsed)) return onError(`${setting.key} must be a number.`);
    } else if (kind === "boolean") {
      parsed = draft === "true";
    } else if (kind === "json") {
      try {
        parsed = JSON.parse(draft);
      } catch {
        return onError(`${setting.key} must be valid JSON.`);
      }
    } else {
      parsed = draft;
    }
    setBusy(true);
    try {
      await dataCenterAdmin.configSet(setting.key, parsed);
      await onSaved();
    } catch (err) {
      onError(err instanceof DataCenterError ? err.message : "Could not save that setting.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * The two typed editors take a row of their own under the setting, the
   * full width of the card: a spelling, a model and their labels do not fit
   * the value column, and the message that holds Save belongs beside the
   * editor, not folded into the actions column. Discard remounts the editor
   * from the stored value (`resetSeq` is its key) and clears the message, so
   * a blank row added and then discarded actually goes.
   */
  const editor =
    typed === "partners" && facets ? (
      <PartnerSizeEditor
        key={resetSeq}
        id={setting.key}
        value={safeParse(draft)}
        partners={facets.partners.filter((p) => p.name).map((p) => ({ id: p.id, name: p.name }))}
        disabled={!canEdit || busy}
        onChange={onTyped}
      />
    ) : typed === "models" && facets ? (
      <ModelMapEditor
        key={resetSeq}
        id={setting.key}
        value={safeParse(draft)}
        models={facets.salesModels}
        disabled={!canEdit || busy}
        onChange={onTyped}
      />
    ) : null;

  const actions = canEdit && (dirty || typedError) && (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        disabled={busy || Boolean(typedError)}
        onClick={save}
        aria-label={`Save ${setting.key}`}
        className="rounded p-1 text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-40"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={discard}
        aria-label={`Discard changes to ${setting.key}`}
        className="rounded p-1 text-gray-500 transition hover:bg-gray-100"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-2" colSpan={editor ? 2 : 1}>
          <span className="block font-mono text-xs text-gray-700">{setting.key}</span>
          {setting.description && (
            <span className="mt-0.5 block text-xs text-gray-500">{setting.description}</span>
          )}
        </td>
        {!editor && (
          <td className="px-3 py-2">
            {kind === "boolean" ? (
              /*
                Converted for one look across the app, not for the search. Two
                options is far below the threshold, so this renders as a plain
                list - which is the point of having a threshold rather than a
                search box on everything.
              */
              <SearchableSelect
                value={draft}
                onChange={setDraft}
                disabled={!canEdit || busy}
                ariaLabel={setting.key}
                options={[
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ]}
              />
            ) : kind === "json" ? (
              <textarea
                rows={2}
                value={draft}
                disabled={!canEdit || busy}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={setting.key}
                className={`${FIELD_CLASS} font-mono text-xs`}
              />
            ) : (
              <input
                type={kind === "number" ? "number" : "text"}
                value={draft}
                disabled={!canEdit || busy}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={setting.key}
                className={FIELD_CLASS}
              />
            )}
          </td>
        )}
        <td className="w-24 px-3 py-2 text-right">{actions}</td>
      </tr>
      {editor && (
        <tr className="border-t-0">
          <td colSpan={3} className="px-3 pb-3 pt-0">
            {editor}
            {typedError && (
              <p className="mt-1.5 text-xs text-(--dc-sev-warning)" role="status">
                {typedError}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Variables() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /*
   * Partners and payment models for the two typed editors, from the facets
   * read the records filters already use. Read once; if it fails the two
   * settings fall back to their JSON box rather than to nothing.
   */
  const [facets, setFacets] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await dataCenterAdmin.configRead());
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    dataCenterClient
      .recordFacets()
      .then((f) => setFacets({ partners: f.partners ?? [], salesModels: f.salesModels ?? [] }))
      .catch(() => setFacets(null));
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 text-sm text-gray-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings...
      </div>
    );
  }

  const canEdit = data?.canEdit === true;
  const settings = data?.config ?? [];
  const groups = [...new Set(settings.map((s) => groupOf(s.key)))].sort();

  return (
    <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-(--dc-accent-soft)/30 p-5">
        <div className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-(--dc-accent)" />
          <h2 className="text-sm font-semibold text-gray-900">Variables</h2>
        </div>
        <p className="text-sm text-gray-600">
          {canEdit
            ? "Batch size, how many times a number is chased, how long before quiet work is taken back. Every rule reads these at run time."
            : "The numbers every rule reads. Changing them needs the registry.manage permission."}
        </p>
      </div>

      {error && <p className="px-5 pt-3 text-sm text-red-600">{error}</p>}

      <div className="p-5">
        {groups.map((group) => (
          <section key={group} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
              {GROUP_LABEL[group] ?? group}
            </h3>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {settings
                    .filter((s) => groupOf(s.key) === group)
                    .map((s) => (
                      <Row
                        key={s.key}
                        setting={s}
                        canEdit={canEdit}
                        onSaved={load}
                        onError={setError}
                        facets={facets}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

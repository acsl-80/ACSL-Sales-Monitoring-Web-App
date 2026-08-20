import { useCallback, useEffect, useState } from "react";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
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

/** What kind of control the stored value asks for. */
function kindOf(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  return "json";
}

function Row({ setting, canEdit, onSaved, onError }) {
  const kind = kindOf(setting.value);
  const asText = kind === "json" ? JSON.stringify(setting.value) : String(setting.value);
  const [draft, setDraft] = useState(asText);
  const [busy, setBusy] = useState(false);

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

  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <span className="block font-mono text-xs text-gray-700">{setting.key}</span>
        {setting.description && (
          <span className="mt-0.5 block text-xs text-gray-500">{setting.description}</span>
        )}
      </td>
      <td className="px-3 py-2">
        {kind === "boolean" ? (
          <select
            value={draft}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={setting.key}
            className={FIELD_CLASS}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
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
      <td className="w-24 px-3 py-2 text-right">
        {canEdit && dirty && (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              aria-label={`Save ${setting.key}`}
              className="rounded p-1 text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDraft(asText)}
              aria-label={`Discard changes to ${setting.key}`}
              className="rounded p-1 text-gray-500 transition hover:bg-gray-100"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function Variables() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

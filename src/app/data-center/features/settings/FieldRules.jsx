import { useCallback, useEffect, useState } from "react";
import { Loader2, CalendarClock, Check } from "lucide-react";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
import { LIVE_FIELDS, fieldLabel, groupLabel } from "@/lib/saleDictionary";

/**
 * Which sale field is mandatory from which day (slice F3a, agreement A5).
 *
 * One row per field of the dictionary that lives on the sale or its address.
 * A date makes the field mandatory for every sale dated on or after it; the
 * sales app's status rule, the module's completeness rule, the phone app and
 * the web forms all read the same table, so moving a date here moves the rule
 * everywhere without a release. A field with no date carries no rule. History
 * is never made incomplete: a sale is judged by the rules dated on or before
 * its own sales date.
 */

const SINCE_ALWAYS = "2000-01-01";
const INPUT =
  "rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

const SCOPES = [
  { key: "sales_app", label: "Sales app" },
  { key: "data_center", label: "Data Center" },
];

/** The dictionary's fields that can carry a rule: columns of the sale or its address. */
const RULEABLE = LIVE_FIELDS.filter((f) => f.table === "sales" || f.table === "addresses");

export default function FieldRules() {
  const [rules, setRules] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await dataCenterAdmin.fieldRules();
      setRules(r.rules ?? []);
      setCanEdit(Boolean(r.canEdit));
      setDrafts({});
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "The rules could not be read.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byKey = Object.fromEntries((rules ?? []).map((r) => [r.field_key, r]));

  const draftOf = (field) => {
    const rule = byKey[field.key];
    return (
      drafts[field.key] ?? {
        date: rule?.mandatory_from ?? "",
        scopes: rule?.applies_to ?? ["sales_app", "data_center"],
      }
    );
  };

  const setDraft = (key, patch) =>
    setDrafts((d) => ({
      ...d,
      [key]: { ...draftOf(RULEABLE.find((f) => f.key === key)), ...patch },
    }));

  const save = async (field) => {
    const draft = draftOf(field);
    setSaving(field.key);
    setError("");
    try {
      await dataCenterAdmin.setFieldRule({
        fieldKey: field.key,
        mandatoryFrom: draft.date ? draft.date : null,
        appliesTo: draft.scopes.length ? draft.scopes : undefined,
      });
      setSaved(field.key);
      setTimeout(() => setSaved(""), 2000);
      await load();
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "The rule could not be saved.");
    } finally {
      setSaving("");
    }
  };

  const dirty = (field) => {
    const rule = byKey[field.key];
    const draft = draftOf(field);
    const was = {
      date: rule?.mandatory_from ?? "",
      scopes: (rule?.applies_to ?? ["sales_app", "data_center"]).slice().sort().join(","),
    };
    return was.date !== draft.date || was.scopes !== draft.scopes.slice().sort().join(",");
  };

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white"
      aria-labelledby="field-rules-heading"
    >
      <header className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
        <CalendarClock className="mt-0.5 h-5 w-5 text-(--dc-accent)" aria-hidden="true" />
        <div>
          <h2 id="field-rules-heading" className="text-base font-semibold text-gray-900">
            Field rules
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            A date makes a field mandatory for every sale dated on or after it. The sales app, this
            module, the phone app and the forms all read this table, so a date moved here moves the
            rule everywhere. A sale is judged by the rules dated on or before its own sales date, so
            history is never made incomplete. Leave the date empty to lift a rule.
          </p>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {rules === null ? (
        <p className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the rules...
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Field</th>
                <th className="px-4 py-2 font-medium">Mandatory from</th>
                <th className="px-4 py-2 font-medium">Read by</th>
                <th className="px-4 py-2 font-medium">Note</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {RULEABLE.map((field) => {
                const rule = byKey[field.key];
                const draft = draftOf(field);
                const dateId = `rule-date-${field.key}`;
                return (
                  <tr key={field.key} className={rule?.mandatory_from ? "" : "text-gray-500"}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{fieldLabel(field.key)}</div>
                      <div className="text-xs text-gray-500">{groupLabel(field.key)}</div>
                    </td>
                    <td className="px-4 py-2">
                      <label htmlFor={dateId} className="sr-only">
                        {fieldLabel(field.key)} mandatory from
                      </label>
                      <input
                        id={dateId}
                        type="date"
                        className={INPUT}
                        value={draft.date}
                        disabled={!canEdit}
                        onChange={(e) => setDraft(field.key, { date: e.target.value })}
                      />
                      {rule?.mandatory_from === SINCE_ALWAYS && (
                        <div className="mt-0.5 text-xs text-gray-500">Since the form existed</div>
                      )}
                      {rule && rule.mandatory_from === null && (
                        <div className="mt-0.5 text-xs text-gray-500">Lifted</div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-3">
                        {SCOPES.map((s) => {
                          const id = `rule-scope-${field.key}-${s.key}`;
                          return (
                            <span key={s.key} className="inline-flex items-center gap-1">
                              <input
                                id={id}
                                type="checkbox"
                                checked={draft.scopes.includes(s.key)}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  setDraft(field.key, {
                                    scopes: e.target.checked
                                      ? [...draft.scopes, s.key]
                                      : draft.scopes.filter((k) => k !== s.key),
                                  })
                                }
                              />
                              <label htmlFor={id}>{s.label}</label>
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-2 text-xs text-gray-600">{rule?.note ?? ""}</td>
                    <td className="px-4 py-2 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={!dirty(field) || saving === field.key}
                          onClick={() => save(field)}
                        >
                          {saving === field.key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : saved === field.key ? (
                            <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                          ) : null}
                          {saved === field.key ? "Saved" : "Save"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

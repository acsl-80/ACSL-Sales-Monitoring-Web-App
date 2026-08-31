import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
import { usePaged } from "../../lib/usePaged";
import Pagination from "../../components/Pagination";
import { plural } from "../../lib/plural";
import {
  Loader2,
  ListChecks,
  Plus,
  Check,
  X,
  Pencil,
  EyeOff,
  Eye,
  ClipboardList,
} from "lucide-react";

/**
 * Editing the call form without a release.
 *
 * The questions an agent answers and the choices behind every dropdown have
 * always been rows in `field_defs` and `option_values` - the renderer knows
 * about input types and never about specific questions. What was missing was
 * anywhere to put a row. Adding a question meant a migration written by someone
 * who could write migrations, which is not who knows what to ask.
 *
 * Two halves, because they are two different jobs. Questions are the shape of
 * the form; choices are the words inside one control. Someone adding "Something
 * else" to the outcomes is not redesigning the form.
 *
 * Nothing here deletes. A question is retired and a choice is deactivated,
 * because records point at both and history is not rewritten by a change of
 * mind about what to ask next.
 */

const INPUT_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "One from a list" },
  { value: "multiselect", label: "Several from a list" },
  { value: "boolean", label: "Yes or no" },
];

const TYPE_LABEL = Object.fromEntries(INPUT_TYPES.map((t) => [t.value, t.label]));

const FIELD_CLASS =
  "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

/** A label the user typed becomes the key, so nobody has to invent both. */
const slugify = (label) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

/* ---------------------------------------------------------------- choices */

function OptionListEditor({ lists, canEdit, onSaved, onError }) {
  const [listKey, setListKey] = useState(lists[0]?.key ?? "");
  const [draft, setDraft] = useState({ label: "", sortOrder: "" });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = lists.find((l) => l.key === listKey) ?? lists[0];
  const values = list?.values ?? [];
  const paged = usePaged(values, 10);

  const save = async (payload) => {
    setBusy(true);
    try {
      await dataCenterAdmin.upsertOptionValue(payload);
      await onSaved();
      setDraft({ label: "", sortOrder: "" });
      setEditing(null);
    } catch (err) {
      onError(err instanceof DataCenterError ? err.message : "Could not save that choice.");
    } finally {
      setBusy(false);
    }
  };

  if (!list) return <p className="text-sm text-gray-500">No option lists yet.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Dropdown">
          <div className="sm:w-64">
            <SearchableSelect
              ariaLabel="Dropdown"
              value={list.key}
              onChange={setListKey}
              searchPlaceholder="Type part of a list name"
              emptyLabel="No list matches that"
              options={lists.map((l) => ({ value: l.key, label: l.label }))}
            />
          </div>
        </Field>
        <p className="pb-1.5 text-sm text-gray-600">
          {list.description || plural(values.length, "choice")}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
              <th className="px-3 py-2 font-semibold">Shown as</th>
              <th className="px-3 py-2 font-semibold">Stored as</th>
              <th className="w-20 px-3 py-2 text-right font-semibold">Order</th>
              <th className="w-32 px-3 py-2 font-semibold">State</th>
              {canEdit && <th className="w-24 px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paged.slice.map((v) => {
              const isEditing = editing?.id === v.id;
              return (
                <tr key={v.id} className={v.is_active ? "" : "bg-gray-50 text-gray-500"}>
                  <td className="px-3 py-1.5">
                    {isEditing ? (
                      <input
                        value={editing.label}
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        className={FIELD_CLASS}
                        aria-label="Choice label"
                      />
                    ) : (
                      v.label
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{v.value}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editing.sortOrder}
                        onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value })}
                        className={`${FIELD_CLASS} text-right`}
                        aria-label="Choice order"
                      />
                    ) : (
                      v.sort_order
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {v.is_active ? (
                      <span className="text-xs text-gray-600">Offered</span>
                    ) : (
                      <span className="text-xs text-amber-700">Retired</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-1.5 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            aria-label="Save choice"
                            onClick={() =>
                              save({
                                listKey: list.key,
                                id: v.id,
                                label: editing.label,
                                sortOrder: Number(editing.sortOrder) || 0,
                                isActive: v.is_active,
                              })
                            }
                            className="rounded p-1 text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-40"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Cancel"
                            onClick={() => setEditing(null)}
                            className="rounded p-1 text-gray-500 transition hover:bg-gray-100"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label={`Rename ${v.label}`}
                            onClick={() =>
                              setEditing({ id: v.id, label: v.label, sortOrder: v.sort_order })
                            }
                            className="rounded p-1 text-gray-500 transition hover:bg-(--dc-accent-soft) hover:text-(--dc-accent)"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={
                              v.is_active ? `Retire ${v.label}` : `Offer ${v.label} again`
                            }
                            onClick={() =>
                              save({
                                listKey: list.key,
                                id: v.id,
                                label: v.label,
                                sortOrder: v.sort_order,
                                isActive: !v.is_active,
                              })
                            }
                            className="rounded p-1 text-gray-500 transition hover:bg-(--dc-accent-soft) hover:text-(--dc-accent) disabled:opacity-40"
                          >
                            {v.is_active ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
          noun="choice"
        />
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 p-3">
          <div className="min-w-48 flex-1">
            <Field label="Add a choice" hint={`Stored as ${slugify(draft.label) || "..."}`}>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="What the agent sees"
                className={FIELD_CLASS}
              />
            </Field>
          </div>
          <div className="w-24">
            <Field label="Order">
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                className={FIELD_CLASS}
              />
            </Field>
          </div>
          <button
            type="button"
            disabled={busy || !slugify(draft.label)}
            onClick={() =>
              save({
                listKey: list.key,
                value: slugify(draft.label),
                label: draft.label.trim(),
                sortOrder: Number(draft.sortOrder) || values.length + 1,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-2 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add choice
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- questions */

const BLANK_FIELD = {
  key: "",
  label: "",
  section: "",
  inputType: "text",
  optionListKey: "",
  sortOrder: "",
  isRequired: false,
  helpText: "",
};

function FieldEditor({ fields, lists, canEdit, onSaved, onError }) {
  const [draft, setDraft] = useState(BLANK_FIELD);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("all");

  const sections = useMemo(
    () => [...new Set(fields.map((f) => f.section))].sort(),
    [fields],
  );
  const shown = useMemo(
    () => (section === "all" ? fields : fields.filter((f) => f.section === section)),
    [fields, section],
  );
  const paged = usePaged(shown, 10);

  const needsList = draft.inputType === "select" || draft.inputType === "multiselect";

  const submit = async () => {
    setBusy(true);
    try {
      await dataCenterAdmin.upsertField({
        key: draft.key || slugify(draft.label),
        label: draft.label.trim(),
        section: draft.section.trim(),
        inputType: draft.inputType,
        optionListKey: needsList ? draft.optionListKey : null,
        sortOrder: Number(draft.sortOrder) || 0,
        isRequired: draft.isRequired,
        helpText: draft.helpText.trim() || null,
      });
      await onSaved();
      setDraft(BLANK_FIELD);
    } catch (err) {
      onError(err instanceof DataCenterError ? err.message : "Could not save that question.");
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (field, isActive) => {
    setBusy(true);
    try {
      await dataCenterAdmin.upsertField({
        key: field.key,
        label: field.label,
        section: field.section,
        inputType: field.input_type,
        optionListKey: field.option_list_key,
        sortOrder: field.sort_order,
        isRequired: field.is_required,
        helpText: field.help_text,
        visibleWhen: field.visible_when ?? null,
        isActive,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof DataCenterError ? err.message : "Could not change that question.");
    } finally {
      setBusy(false);
    }
  };

  const ready =
    draft.label.trim() && draft.section.trim() && (!needsList || draft.optionListKey);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Section">
          <div className="sm:w-56">
            <SearchableSelect
              ariaLabel="Section"
              value={section}
              onChange={setSection}
              searchPlaceholder="Type part of a section"
              emptyLabel="No section matches that"
              pinned={{ value: "all", label: "Every section" }}
              options={sections.map((sec) => ({ value: sec, label: sec }))}
            />
          </div>
        </Field>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                <th className="px-3 py-2 font-semibold">Question</th>
                <th className="px-3 py-2 font-semibold">Section</th>
                <th className="px-3 py-2 font-semibold">Answered with</th>
                <th className="w-20 px-3 py-2 text-right font-semibold">Order</th>
                <th className="w-24 px-3 py-2 font-semibold">State</th>
                {canEdit && <th className="w-16 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.slice.map((f) => (
                <tr key={f.key} className={f.is_active ? "" : "bg-gray-50 text-gray-500"}>
                  <td className="px-3 py-1.5">
                    <span className="block">{f.label}</span>
                    <span className="block font-mono text-xs text-gray-500">{f.key}</span>
                    {f.visible_when?.field && (
                      <span className="mt-0.5 block text-xs text-gray-500">
                        Only when {f.visible_when.field} is{" "}
                        {(f.visible_when.in ?? []).join(" or ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{f.section}</td>
                  <td className="px-3 py-1.5">
                    {TYPE_LABEL[f.input_type] ?? f.input_type}
                    {f.option_list_key && (
                      <span className="block text-xs text-gray-500">{f.option_list_key}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{f.sort_order}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {f.is_active ? (
                      <span className="text-gray-600">
                        {f.is_required ? "Asked, required" : "Asked"}
                      </span>
                    ) : (
                      <span className="text-amber-700">Retired</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={f.is_active ? `Retire ${f.label}` : `Ask ${f.label} again`}
                        onClick={() => setActive(f, !f.is_active)}
                        className="rounded p-1 text-gray-500 transition hover:bg-(--dc-accent-soft) hover:text-(--dc-accent) disabled:opacity-40"
                      >
                        {f.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
          noun="question"
        />
      </div>

      {canEdit && (
        <div className="mt-3 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
            Add a question
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Question" hint={`Stored as ${slugify(draft.label) || "..."}`}>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="What the agent is asked"
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Section" hint="Groups it on the form. An existing name or a new one.">
              <input
                list="dc-field-sections"
                value={draft.section}
                onChange={(e) => setDraft({ ...draft, section: e.target.value })}
                className={FIELD_CLASS}
              />
              <datalist id="dc-field-sections">
                {sections.map((sec) => (
                  <option key={sec} value={sec} />
                ))}
              </datalist>
            </Field>
            <Field label="Answered with">
              <SearchableSelect
                ariaLabel="Answered with"
                value={draft.inputType}
                onChange={(next) => setDraft({ ...draft, inputType: next })}
                options={INPUT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
            </Field>
            {needsList && (
              <Field label="From which dropdown">
                <SearchableSelect
                  ariaLabel="From which dropdown"
                  value={draft.optionListKey}
                  onChange={(next) => setDraft({ ...draft, optionListKey: next })}
                  placeholder="Pick a list..."
                  searchPlaceholder="Type part of a list name"
                  emptyLabel="No list matches that"
                  options={lists.map((l) => ({ value: l.key, label: l.label }))}
                />
              </Field>
            )}
            <Field label="Order">
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Help text">
              <input
                value={draft.helpText}
                onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
                placeholder="Shown under the input"
                className={FIELD_CLASS}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={draft.isRequired}
                onChange={(e) => setDraft({ ...draft, isRequired: e.target.checked })}
                className="h-4 w-4 accent-(--dc-accent)"
              />
              Must be answered
            </label>
            <button
              type="button"
              disabled={busy || !ready}
              onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-2 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

const TABS = [
  { key: "fields", label: "Questions", icon: ClipboardList },
  { key: "options", label: "Dropdowns", icon: ListChecks },
];

export default function CallFormEditor() {
  const [tab, setTab] = useState("fields");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await dataCenterAdmin.registryRead());
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the call form.");
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
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the call form...
      </div>
    );
  }

  const canEdit = data?.canEdit === true;

  return (
    <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-(--dc-accent-soft)/30 p-5">
        <div className="mb-1 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-(--dc-accent)" />
          <h2 className="text-sm font-semibold text-gray-900">Call form</h2>
        </div>
        <p className="text-sm text-gray-600">
          {canEdit
            ? "Add a question to the call log, or change the choices behind a dropdown. Both take effect on the next page load, with no release."
            : "The questions on the call log and the choices behind each dropdown. Changing them needs the registry.manage permission."}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const selected = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  selected
                    ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="px-5 pt-3 text-sm text-red-600">{error}</p>}

      <div className="p-5">
        {tab === "fields" ? (
          <FieldEditor
            fields={data?.fields ?? []}
            lists={data?.lists ?? []}
            canEdit={canEdit}
            onSaved={load}
            onError={setError}
          />
        ) : (
          <OptionListEditor
            lists={data?.lists ?? []}
            canEdit={canEdit}
            onSaved={load}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}

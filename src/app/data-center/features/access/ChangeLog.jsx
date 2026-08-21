import { useCallback, useEffect, useState } from "react";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
import ExportButton from "../../components/ExportButton";
import { plural } from "../../lib/plural";
import {
  Loader2,
  History,
  PhoneCall,
  PhoneOutgoing,
  FileText,
  Upload,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  Circle,
} from "lucide-react";

/**
 * The Data Centre's log: who did what, to what, and when.
 *
 * It used to render the audit table as it is stored — `UPDATE`, a table name,
 * and a primary key — which is a row of the database, not a record of the work.
 * Nobody could read it. This says the same thing as a sentence, groups the
 * sentences by day, and lets you ask for one part of the module at a time.
 *
 * Written by a database trigger, so nothing an editor does can skip it. The
 * category and the changed field names are computed in the query, so the chips
 * here and the filter there cannot drift apart.
 */

/**
 * One entry per category the server can return, including `other`, which is
 * where a newly audited table lands until it is given a home. Visible is better
 * than dropped: an unnamed category on screen is a prompt to name it.
 */
const CATEGORIES = [
  { key: "call_records", label: "Call records", icon: PhoneCall,
    subject: "call record", blurb: "Enrichment and verification on a record" },
  { key: "calls", label: "Calls logged", icon: PhoneOutgoing,
    subject: "call attempt", blurb: "Each attempt an agent recorded" },
  { key: "documents", label: "Documents", icon: FileText,
    subject: "consignment", blurb: "Paper coming back from the field" },
  { key: "imports", label: "Imports", icon: Upload,
    subject: "import batch", blurb: "Digitalised receipts staged and committed" },
  { key: "assignment", label: "Assignment", icon: ListChecks,
    subject: "assignment batch", blurb: "Work handed to call agents" },
  { key: "access", label: "Access", icon: ShieldCheck,
    subject: "access grant", blurb: "Who may enter the module" },
  { key: "configuration", label: "Configuration", icon: SlidersHorizontal,
    subject: "setting", blurb: "Fields, option lists and workflow settings" },
  { key: "other", label: "Other", icon: Circle,
    subject: "record", blurb: "Anything not yet categorised" },
];

const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

/**
 * The verb. An insert on an access grant is "granted", not "created"; a delete
 * on one is "revoked", not "deleted". A log that reads like the business reads
 * faster than a log that reads like the table.
 */
const VERBS = {
  access: { INSERT: "granted", UPDATE: "changed", DELETE: "revoked" },
  calls: { INSERT: "logged", UPDATE: "amended", DELETE: "removed" },
  imports: { INSERT: "started", UPDATE: "advanced", DELETE: "discarded" },
  assignment: { INSERT: "opened", UPDATE: "updated", DELETE: "cancelled" },
  documents: { INSERT: "recorded", UPDATE: "updated", DELETE: "removed" },
  default: { INSERT: "added", UPDATE: "updated", DELETE: "deleted" },
};

const ACTION_TONE = {
  INSERT: "text-(--dc-accent)",
  UPDATE: "text-amber-700",
  DELETE: "text-red-600",
};

/** "an access grant", not "a access grant". */
const article = (word) => ("aeiou".includes(word[0]?.toLowerCase()) ? "an" : "a");

/** `verification_outcome` reads as "verification outcome", not as a column. */
const fieldLabel = (f) => f.replace(/_/g, " ");

/** A uuid in full is noise; its first segment is enough to match two lines. */
const shortRef = (pk) => (pk && pk.length > 12 ? `${pk.slice(0, 8)}...` : pk || "-");

/** Today and yesterday by name, everything older by date. */
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

const time = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const label = dayLabel(entry.changed_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

/** What the log export offers. Ids last: they are for matching, not reading. */
const LOG_EXPORT_COLUMNS = [
  { key: "changed_at", label: "When", get: (r) => new Date(r.changed_at).toISOString() },
  { key: "who", label: "Who" },
  { key: "category_label", label: "Part of the module" },
  { key: "action", label: "Action" },
  { key: "subject", label: "What" },
  { key: "fields_changed", label: "Fields changed" },
  { key: "record_pk", label: "Reference" },
  { key: "table_name", label: "Table" },
];

function Entry({ entry }) {
  const category = BY_KEY[entry.category] ?? BY_KEY.other;
  const Icon = category.icon;
  const verbs = VERBS[entry.category] ?? VERBS.default;
  const verb = verbs[entry.action] ?? VERBS.default[entry.action] ?? "changed";
  const fields = entry.changed_fields ?? [];

  return (
    <li className="flex gap-3 px-4 py-2.5 transition hover:bg-(--dc-accent-soft)/40">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">
          <span className="font-medium text-gray-900">
            {entry.changed_by_name || "The system"}
          </span>{" "}
          <span className={`font-medium ${ACTION_TONE[entry.action] ?? "text-gray-700"}`}>
            {verb}
          </span>{" "}
          {article(category.subject)} {category.subject}{" "}
          <span className="font-mono text-xs text-gray-500">{shortRef(entry.record_pk)}</span>
        </p>
        {fields.length > 0 && (
          <p className="mt-0.5 text-xs text-gray-500">
            {plural(fields.length, "field")} changed:{" "}
            <span className="text-gray-700">{fields.map(fieldLabel).join(", ")}</span>
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-gray-500">
        {time(entry.changed_at)}
      </span>
    </li>
  );
}

export default function ChangeLog() {
  const [category, setCategory] = useState("all");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (which) => {
    setLoading(true);
    try {
      setEntries(await dataCenterAdmin.changeLog(100, which));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(category);
  }, [load, category]);

  const exportRows = () =>
    entries.map((e) => ({
      ...e,
      category_label: (BY_KEY[e.category] ?? BY_KEY.other).label,
      subject: (BY_KEY[e.category] ?? BY_KEY.other).subject,
      fields_changed: (e.changed_fields ?? []).join(" "),
      who: e.changed_by_name || "system",
    }));

  const groups = groupByDay(entries);
  const active = category === "all" ? null : BY_KEY[category];

  return (
    <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-(--dc-accent-soft)/30 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <History className="h-4 w-4 text-(--dc-accent)" />
              <h2 className="text-sm font-semibold text-gray-900">Recent changes</h2>
            </div>
            <p className="text-sm text-gray-600">
              {active
                ? active.blurb
                : "Every change anyone makes inside the Data Center, newest first."}
            </p>
          </div>
          <ExportButton
            columns={LOG_EXPORT_COLUMNS}
            rows={exportRows}
            filename={`data-center-changes-${category}.csv`}
            disabled={entries.length === 0}
          />
        </div>

        {/* One filter row. Categories are what a reader actually asks for:
            "what happened to the call records", not "what happened to
            data_center.call_records". */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[{ key: "all", label: "Everything" }, ...CATEGORIES].map((c) => {
            const selected = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(c.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  selected
                    ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="px-5 py-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the log...
        </div>
      ) : entries.length === 0 ? (
        <div className="m-5 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-6 text-center text-sm text-gray-600">
          {category === "all"
            ? "Nothing has been changed yet."
            : `No ${active?.label.toLowerCase()} changes yet.`}
        </div>
      ) : (
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "clamp(320px, 62dvh, 620px)" }}
        >
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="sticky top-0 z-10 border-y border-gray-100 bg-(--dc-surface-muted) px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                {group.label}
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-500">
                  {plural(group.entries.length, "change")}
                </span>
              </h3>
              <ul className="divide-y divide-gray-50">
                {group.entries.map((entry) => (
                  <Entry key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

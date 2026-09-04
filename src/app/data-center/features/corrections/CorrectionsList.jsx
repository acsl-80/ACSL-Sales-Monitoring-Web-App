import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterCorrections, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import { dateOf } from "../../lib/when";
import ExportButton from "../../components/ExportButton";
import {
  Loader2, AlertTriangle, Check, CircleAlert, Undo2, RotateCcw, PhoneOff, PhoneCall, ArrowRight,
} from "lucide-react";

/**
 * Everything the call centre sent back, in the three states a correction
 * moves through: waiting on Sales, fixed and awaiting review, closed.
 *
 * Phase 24 replaces the grouped list that offered one button. A row now says
 * which fields are disputed, who has it and how long it has waited, and the
 * action on the row is the one that moves the episode: Sales marks it fixed
 * and says what they did; the call centre closes it (ring again, or nothing
 * to ring) or sends it back again. The record itself opens from the stove ID,
 * and from slice 2 from the workspace, where the sale is edited through the
 * sales app's own path.
 */

const TABS = [
  { key: "open", label: "Waiting on Sales", tone: "bg-red-100 text-red-800" },
  { key: "fixed", label: "Awaiting review", tone: "bg-amber-100 text-amber-900" },
  { key: "resolved", label: "Closed", tone: "bg-gray-100 text-gray-700" },
];

const STATE_PILL = {
  open: "bg-red-100 text-red-800",
  fixed: "bg-amber-100 text-amber-900",
  resolved: "bg-(--dc-accent-soft) text-(--dc-accent-strong)",
};

const STATE_WORD = { open: "Waiting on Sales", fixed: "Awaiting review", resolved: "Closed" };

const OUTCOME_WORD = {
  recall: "closed, rung again",
  no_recall: "closed, nothing to ring",
  withdrawn: "withdrawn by the call centre",
  reopened: "sent back again",
};

const EXPORT_COLUMNS = [
  { key: "state", label: "State" },
  { key: "partner_name", label: "Partner" },
  { key: "sales_rep", label: "Sales rep" },
  { key: "rep_account_name", label: "Rep account" },
  { key: "stove_serial_no", label: "Stove ID" },
  { key: "transfer_reference", label: "Consignment" },
  { key: "end_user_name", label: "Buyer" },
  { key: "phone", label: "Phone" },
  { key: "reason_label", label: "Why it came back" },
  { key: "disputed_fields", label: "Disputed fields" },
  { key: "note", label: "Note" },
  { key: "opened_by_name", label: "Sent back by" },
  { key: "opened_at", label: "Sent back on" },
  { key: "assigned_to_name", label: "Who has it" },
  { key: "fixed_by_name", label: "Fixed by" },
  { key: "fixed_at", label: "Fixed on" },
  { key: "fix_note", label: "Fix note" },
  { key: "reviewed_by_name", label: "Reviewed by" },
  { key: "review_outcome", label: "Outcome" },
];

const FIELD_LABELS = {
  end_user_name: "name",
  aka: "aka",
  phone: "phone",
  other_phone: "other phone",
  contact_person: "contact person",
  contact_phone: "contact phone",
  full_address: "address",
  state_backup: "state",
  lga_backup: "LGA",
  stove_serial_no: "stove ID",
  sales_date: "sale date",
  amount: "amount",
  total_paid: "amount received",
  pot_quantity: "pots",
  heat_retention_device: "heat retention device",
  previous_stove_type: "previous stove",
  previous_stove_other: "previous stove, other",
  meals_per_day: "meals per day",
  cooking_fuel_source: "cooking fuel",
  cooking_location: "cooking location",
  signature: "signature",
  agreement_image_id: "agreement image",
  stove_image_id: "stove image",
};

function ageOf(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return `${days} d`;
}

function whoHasIt(row) {
  if (row.state === "fixed") {
    return `Fixed by ${row.fixed_by_name ?? "somebody"}${row.fixed_on_behalf ? ` for ${row.fixed_on_behalf}` : ""}`;
  }
  if (row.state === "resolved") {
    return `${OUTCOME_WORD[row.review_outcome] ?? "closed"}${row.reviewed_by_name ? ` by ${row.reviewed_by_name}` : ""}`;
  }
  if (row.assigned_to_name) return row.assigned_to_name;
  if (row.rep_account_name) return `${row.rep_account_name}${row.via_delegate ? " (delegate)" : ""}`;
  return null;
}

/** A small inline form: one line of text and a button, the way Resolve was. */
function NoteAction({ label, placeholder, submitLabel, icon: Icon, tone, onSubmit, required }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (required && !note.trim()) {
      setError("Say what you did first.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(note.trim() || null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not save.");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${tone}`}
      >
        <Icon className="h-3 w-3" /> {label}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-(--dc-accent)/30 bg-(--dc-accent-soft)/30 p-2">
      <input
        type="text"
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none"
      />
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="inline-flex items-center gap-1 rounded-md bg-(--dc-accent) px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        Cancel
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}

function RowActions({ row, data, reload }) {
  const saleId = row.sale_id;
  const mayFix = data.canFix && (row.is_mine || data.seesEverything || row.assigned_to);

  if (row.state === "open") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {mayFix && (
          <NoteAction
            label="Mark it fixed"
            placeholder="What did you do? The call centre reads this before ringing again."
            submitLabel="Send for review"
            icon={Check}
            tone="border border-(--dc-accent)/40 text-(--dc-accent) hover:bg-(--dc-accent-soft)"
            onSubmit={async (note) => {
              await dataCenterCorrections.fix(saleId, note);
              reload();
            }}
          />
        )}
        {data.canReview && (
          <NoteAction
            label="Withdraw"
            placeholder="Why the call centre is taking it back."
            submitLabel="Withdraw"
            icon={Undo2}
            tone="text-gray-600 hover:bg-gray-100"
            onSubmit={async (note) => {
              await dataCenterCorrections.withdraw(saleId, note);
              reload();
            }}
          />
        )}
      </div>
    );
  }

  if (row.state === "fixed" && data.canReview) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <NoteAction
          label="Ring again"
          placeholder="A word for the agent who rings next. Optional."
          submitLabel="Close and ring again"
          icon={PhoneCall}
          tone="bg-(--dc-accent) text-white hover:bg-(--dc-accent-strong)"
          onSubmit={async (note) => {
            await dataCenterCorrections.review(saleId, "recall", note);
            reload();
          }}
        />
        <NoteAction
          label="Nothing to ring"
          placeholder="Why nothing rings: a duplicate, a cancelled sale."
          submitLabel="Close"
          icon={PhoneOff}
          tone="border border-(--dc-accent)/40 text-(--dc-accent) hover:bg-(--dc-accent-soft)"
          onSubmit={async (note) => {
            await dataCenterCorrections.review(saleId, "no_recall", note);
            reload();
          }}
        />
        <NoteAction
          label="Send back again"
          placeholder="What is still wrong. Sales reads this."
          submitLabel="Send back"
          icon={RotateCcw}
          tone="text-gray-600 hover:bg-gray-100"
          required
          onSubmit={async (note) => {
            await dataCenterCorrections.review(saleId, "reopen", note);
            reload();
          }}
        />
      </div>
    );
  }

  return null;
}

export default function CorrectionsList({ initialTab = "open", initialMine = false }) {
  const [tab, setTab] = useState(initialTab);
  const [mine, setMine] = useState(initialMine);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    dataCenterCorrections
      .list({ tab, mine, limit: 500 })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof DataCenterError ? err.message : "Could not load the corrections."),
      )
      .finally(() => setLoading(false));
  }, [tab, mine]);

  useEffect(load, [load]);

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? { open: 0, fixed: 0, resolved: 0 };
  const partners = useMemo(() => new Set(rows.map((r) => r.partner_name ?? "")).size, [rows]);
  const reps = useMemo(() => new Set(rows.map((r) => r.sales_rep ?? "")).size, [rows]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-900">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the corrections...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.seesEverything && data.unrouted.length > 0 && (
        <div className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-sm text-amber-900">
            <span className="font-semibold">
              {plural(data.unrouted.length, "sales rep")} have work waiting and no account linked:{" "}
              {data.unrouted.map((u) => u.sales_rep).join(", ")}.
            </span>{" "}
            Those records reach this list and the standing recipients. Link the rep, or name a
            delegate, under Settings and every send-back already open finds them.
          </p>
          <Link
            href="/data-center/settings"
            className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Open Settings
          </Link>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
          <Undo2 className="h-4 w-4 text-(--dc-accent)" />
          <span className="text-sm font-semibold text-gray-900">Sent back to Sales</span>
          <span className="text-sm text-gray-500">
            waiting on Sales {counts.open}, awaiting review {counts.fixed}, closed {counts.resolved}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {data.seesEverything && (
              <div className="inline-flex rounded-full border border-gray-300 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setMine(true)}
                  aria-pressed={mine}
                  className={`rounded-full px-2.5 py-1 ${mine ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)" : "text-gray-600"}`}
                >
                  Routed to me
                </button>
                <button
                  type="button"
                  onClick={() => setMine(false)}
                  aria-pressed={!mine}
                  className={`rounded-full px-2.5 py-1 ${!mine ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)" : "text-gray-600"}`}
                >
                  Everyone
                </button>
              </div>
            )}
            <ExportButton
              columns={EXPORT_COLUMNS}
              rows={() => rows.map((r) => ({ ...r, disputed_fields: (r.disputed_fields ?? []).join(" ") }))}
              filename={`corrections-${tab}.csv`}
              label="Export CSV"
            />
          </div>
        </div>

        <div role="tablist" className="flex gap-1 border-b border-gray-200 px-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                tab === t.key
                  ? "border-(--dc-accent) text-(--dc-accent-strong)"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${t.tone}`}>{counts[t.key] ?? 0}</span>
            </button>
          ))}
          {loading && <Loader2 className="ml-auto mt-3 h-4 w-4 animate-spin text-gray-400" />}
        </div>

        {rows.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/15 p-8 text-center">
            <p className="text-sm font-medium text-gray-800">
              {tab === "open" && "Nothing is waiting on Sales."}
              {tab === "fixed" && "Nothing is waiting for review."}
              {tab === "resolved" && "Nothing has been closed yet."}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {data.seesEverything || !mine
                ? "No record is in this state."
                : "No record routed to you is in this state."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2 font-semibold">Partner</th>
                  <th className="px-3 py-2 font-semibold">Sales rep</th>
                  <th className="px-3 py-2 font-semibold">Stove ID</th>
                  <th className="px-3 py-2 font-semibold">What is wrong</th>
                  <th className="px-3 py-2 font-semibold">Disputed</th>
                  <th className="px-3 py-2 font-semibold">Age</th>
                  <th className="px-3 py-2 font-semibold">Who has it</th>
                  <th className="px-3 py-2 font-semibold">State</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const holder = whoHasIt(row);
                  return (
                    <tr key={row.id} className="align-top hover:bg-(--dc-accent-soft)/40">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-900">{row.partner_name ?? "Unknown partner"}</div>
                        <div className="text-xs text-gray-500">{row.transfer_reference ?? "no consignment reference"}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-gray-900">{row.sales_rep ?? "No rep on the consignment"}</div>
                        {row.current_rep_user_id ? (
                          <div className="text-xs text-gray-500">
                            {row.via_delegate ? "delegate: " : ""}{row.rep_account_name ?? "linked account"}
                          </div>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            {row.rep_marked_no_account ? "no account, by design" : "no account linked"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/data-center/stove/${encodeURIComponent(row.stove_serial_no ?? "")}`}
                          className="font-mono text-sm font-semibold text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 hover:decoration-(--dc-accent)"
                        >
                          {row.stove_serial_no ?? "no stove ID"}
                        </Link>
                        <div className="text-xs text-gray-500">{row.end_user_name ?? "no name on the record"}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-gray-900">{row.reason_label ?? "no reason given"}</div>
                        {row.note && <div className="text-xs text-gray-600">"{row.note}"</div>}
                        {row.state === "fixed" && row.fix_note && (
                          <div className="mt-1 text-xs text-(--dc-accent-strong)">Sales: "{row.fix_note}"</div>
                        )}
                        {row.state === "resolved" && row.review_note && (
                          <div className="mt-1 text-xs text-gray-600">Review: "{row.review_note}"</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(row.disputed_fields ?? []).length === 0 && <span className="text-xs text-gray-400">not named</span>}
                          {(row.disputed_fields ?? []).map((f) => (
                            <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                              {FIELD_LABELS[f] ?? f}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-700">
                        {ageOf(row.opened_at)}
                        <div className="text-xs text-gray-400">{dateOf(row.opened_at, "")}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">
                        {holder ?? <span className="text-gray-400">Nobody yet</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_PILL[row.state]}`}>
                          {STATE_WORD[row.state]}
                        </span>
                        {row.seq > 1 && <div className="text-xs text-gray-400">episode {row.seq}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-end gap-1.5">
                          <Link
                            href={`/data-center/corrections/${encodeURIComponent(row.sale_id)}`}
                            className="inline-flex items-center gap-1 rounded-md bg-(--dc-accent) px-2.5 py-1 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong)"
                          >
                            Open record <ArrowRight className="h-3 w-3" />
                          </Link>
                          <RowActions row={row} data={data} reload={load} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
          <span>
            {plural(rows.length, "record")} across {plural(partners, "partner")} and {plural(reps, "sales rep")}.
          </span>
          {rows.length >= 500 && <span>Showing the first 500; export for the rest.</span>}
          <Link href="/data-center/call-centre" className="ml-auto inline-flex items-center gap-1 text-(--dc-accent)">
            Call centre <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

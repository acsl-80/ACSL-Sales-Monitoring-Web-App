import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterClient, dataCenterWrite, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import ExportButton from "../../components/ExportButton";
import {
  Loader2, AlertTriangle, TriangleAlert, Check, ChevronDown, ChevronRight,
  UserRound, Building2, PhoneCall, CircleAlert,
} from "lucide-react";

/**
 * Everything sent back to Sales, grouped the way it gets worked.
 *
 * Sales rep, then partner, then the stove IDs. That order is not arbitrary: a
 * send-back is answered by going through paperwork, and paperwork is filed by
 * who sold it and to whom. A flat list sorted by date would make somebody
 * holding one partner's folder open eleven unrelated records to find the three
 * that concern them.
 *
 * Every stove ID is a link into the record itself, because the list is a way
 * in rather than a report. And every group can be closed, because the person
 * who receives all of them needs to be able to put the ones that are not
 * theirs out of the way.
 *
 * WHY RESOLVING IS A NOTE AND NOT A FORM
 *
 * The record itself is fixed where records are fixed - in the sales app for a
 * wrong phone number, on the stove page for a mismatched ID. What happens here
 * is the closing of the loop: somebody says what they did, and the record goes
 * back to the call centre to be rung again. Rebuilding the sale form here
 * would be a second place a sale can be edited, which is the one thing this
 * module is built never to become.
 */

const when = (v) => (v ? new Date(v).toLocaleDateString() : "-");

const EXPORT_COLUMNS = [
  { key: "sales_rep", label: "Sales rep" },
  { key: "sales_rep_account_name", label: "Rep account" },
  { key: "partner_name", label: "Partner" },
  { key: "transfer_reference", label: "Consignment" },
  { key: "stove_serial_no", label: "Stove ID" },
  { key: "end_user_name", label: "Buyer" },
  { key: "phone", label: "Phone" },
  { key: "correction_reason", label: "Why it came back" },
  { key: "correction_note", label: "Note" },
  { key: "requested_by_name", label: "Sent back by" },
  { key: "correction_requested_at", label: "Sent back on" },
];

function Resolve({ row, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      /*
       * The note goes on before the record is closed, and in that order.
       *
       * `correction` with open:false stamps who resolved it and when, but has
       * nowhere to put what they actually did. Writing the note as a call
       * record field first means the answer survives on the record rather than
       * only in the audit trail, where the next agent to ring this buyer will
       * not think to look.
       */
      if (note.trim()) {
        await dataCenterWrite.saveCallRecord(
          row.sale_id,
          { other_comments: note.trim() },
          null,
        );
      }
      await dataCenterWrite.correction(row.sale_id, false);
      onDone?.(row.sale_id);
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
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--dc-accent)/40 px-2.5 py-1 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
      >
        <Check className="h-3 w-3" /> Mark it fixed
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
        placeholder="What did you do? The call centre reads this before ringing again."
        className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none"
      />
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="inline-flex items-center gap-1 rounded-md bg-(--dc-accent) px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Send it back to the call centre
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

export default function SendBackList() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(() => new Set());

  const load = useCallback(() => {
    dataCenterClient
      .sendBacks(500)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err) =>
        setError(
          err instanceof DataCenterError
            ? err.message
            : "Could not load the records sent back.",
        ),
      );
  }, []);

  useEffect(load, [load]);

  /** Rep, then partner. The order paperwork is filed in. */
  const grouped = useMemo(() => {
    const byRep = new Map();
    for (const row of data?.rows ?? []) {
      const rep = row.sales_rep ?? "No rep on the consignment";
      if (!byRep.has(rep)) {
        byRep.set(rep, {
          rep,
          account: row.sales_rep_account_name,
          hasAccount: Boolean(row.sales_rep_user_id),
          markedNoAccount: Boolean(row.sales_rep_marked_no_account),
          mine: row.is_my_consignment,
          partners: new Map(),
        });
      }
      const entry = byRep.get(rep);
      const partner = row.partner_name ?? "Unknown partner";
      if (!entry.partners.has(partner)) entry.partners.set(partner, []);
      entry.partners.get(partner).push(row);
    }
    // The rep with the most waiting first: it is the biggest thing to do.
    return [...byRep.values()]
      .map((e) => ({
        ...e,
        partners: [...e.partners.entries()],
        total: [...e.partners.values()].reduce((n, list) => n + list.length, 0),
      }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || b.total - a.total);
  }, [data]);

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
        <Loader2 className="h-4 w-4 animate-spin" /> Loading what has been sent back...
      </p>
    );
  }

  if (data.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 p-8 text-center">
        <p className="text-sm font-medium text-gray-800">Nothing is waiting on you.</p>
        <p className="mt-1 text-sm text-gray-600">
          {data.seesEverything
            ? "No record is currently sent back to Sales."
            : "No record from your consignments has been sent back."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        The routing gap, named. A rep with work waiting and no account linked
        means these records are reaching the standing recipients and nobody
        else - survivable, and not what anybody intended.
      */}
      {data.seesEverything && data.unrouted.length > 0 && (
        <div className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-sm text-amber-900">
            <span className="font-semibold">
              {plural(data.unrouted.length, "sales rep")} have work waiting and no
              account linked.
            </span>{" "}
            Those records are reaching this list and nobody else. Link them under
            Settings, and every send-back already open finds its rep.
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
          <TriangleAlert className="h-4 w-4 text-(--dc-accent)" />
          <span className="text-sm font-semibold text-gray-900">Records to fix</span>
          <span className="text-sm text-gray-500">
            {plural(data.rows.length, "record")} across{" "}
            {plural(grouped.length, "sales rep")}
          </span>
          <div className="ml-auto">
            <ExportButton
              columns={EXPORT_COLUMNS}
              rows={() => data.rows}
              filename="records-sent-back.csv"
              label="Export CSV"
            />
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {grouped.map((group) => {
            const isClosed = closed.has(group.rep);
            return (
              <section key={group.rep}>
                <button
                  type="button"
                  onClick={() =>
                    setClosed((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.rep)) next.delete(group.rep);
                      else next.add(group.rep);
                      return next;
                    })
                  }
                  className="flex w-full flex-wrap items-center gap-2 bg-gray-50/80 px-4 py-2.5 text-left transition hover:bg-(--dc-accent-soft)/40"
                >
                  {isClosed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                  )}
                  <UserRound className="h-4 w-4 shrink-0 text-(--dc-accent)" />
                  <span className="font-semibold text-gray-900">{group.rep}</span>
                  {group.mine && (
                    <span className="rounded-full bg-(--dc-accent) px-2 py-0.5 text-xs font-semibold text-white">
                      yours
                    </span>
                  )}
                  {/* The account behind the name, or the absence of one. Said
                      here because this is where somebody wonders why a rep has
                      not answered. */}
                  {group.hasAccount ? (
                    <span className="text-xs text-gray-600">
                      notified as {group.account}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {group.markedNoAccount ? "no account, by design" : "no account linked"}
                    </span>
                  )}
                  <span className="ml-auto text-sm tabular-nums text-gray-600">
                    {plural(group.total, "record")}
                  </span>
                </button>

                {!isClosed &&
                  group.partners.map(([partner, rows]) => (
                    <div key={partner}>
                      <p className="flex items-center gap-1.5 px-4 py-1.5 pl-10 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <Building2 className="h-3 w-3" /> {partner}
                        <span className="font-normal normal-case text-gray-400">
                          · {rows[0].transfer_reference ?? "no consignment reference"}
                        </span>
                      </p>
                      <ul className="divide-y divide-gray-50">
                        {rows.map((row) => (
                          <li
                            key={row.sale_id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 pl-10"
                          >
                            {/* The way in. The list is not a report. */}
                            <Link
                              href={`/data-center/stove/${encodeURIComponent(row.stove_serial_no ?? "")}`}
                              className="shrink-0 font-mono text-sm font-semibold text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 hover:decoration-(--dc-accent)"
                            >
                              {row.stove_serial_no ?? "no stove ID"}
                            </Link>
                            <span className="text-sm text-gray-800">
                              {row.end_user_name ?? "no name on the record"}
                            </span>
                            <span className="text-sm text-gray-500">{row.phone ?? ""}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                              <PhoneCall className="h-3 w-3" />
                              {row.correction_reason ?? "no reason given"}
                            </span>
                            {row.correction_note && (
                              <span className="w-full pl-1 text-xs text-gray-600">
                                “{row.correction_note}”
                              </span>
                            )}
                            <span className="text-xs text-gray-400">
                              sent back {when(row.correction_requested_at)}
                              {row.requested_by_name ? ` by ${row.requested_by_name}` : ""}
                            </span>
                            <div className="ml-auto">
                              <Resolve row={row} onDone={load} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

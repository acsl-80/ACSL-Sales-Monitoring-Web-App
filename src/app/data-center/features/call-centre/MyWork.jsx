import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterAssign, DataCenterError } from "../../lib/client";
import CallRecordEditor from "./CallRecordEditor";
import { plural } from "../../lib/plural";
import {
  Headphones, Loader2, AlertTriangle, PhoneCall, ChevronRight, ShieldAlert,
  Check, CircleDashed,
} from "lucide-react";

/**
 * What a call agent sees when they sit down.
 *
 * They were shown the same surface as a supervisor: the whole call queue,
 * filtered by presets that describe a population, over the assignment log of
 * everybody's work. Nothing on that page said which of it was theirs, so the
 * first act of every shift was to work out where to start.
 *
 * This is their queue and nothing else, arranged by the only question they
 * have: what do I ring next. Grouped by partner, because their batches are
 * per partner by the engine's own rule and a run of one partner's calls is one
 * conversation repeated rather than eight different ones.
 *
 * Ordering says what to do without being told. A stove ID somebody else took
 * comes first - those buyers have a record naming a stove they have never
 * heard of. Then never called, then part-worked, then done. An agent reading
 * top to bottom is working in the right order.
 */

const dateOf = (v) => (v ? new Date(v).toLocaleDateString() : null);

/** Where a record sits, and how urgent that makes it. */
function standing(item) {
  if (item.serial_unconfirmed_at) {
    return { rank: 0, label: "Stove ID unconfirmed", tone: "bg-red-100 text-red-800", icon: ShieldAlert };
  }
  if (!item.attempt_count) {
    return { rank: 1, label: "Not called yet", tone: "bg-blue-100 text-blue-800", icon: CircleDashed };
  }
  if (item.verification_outcome === "fully_verified") {
    return { rank: 4, label: "Verified", tone: "bg-(--dc-accent-soft) text-(--dc-accent-strong)", icon: Check };
  }
  if (item.verification_outcome === "partially_verified") {
    return { rank: 3, label: "Partly verified", tone: "bg-amber-100 text-amber-800", icon: Check };
  }
  if (item.verification_outcome === "unreachable") {
    return { rank: 2, label: "Unreachable", tone: "bg-orange-100 text-orange-800", icon: PhoneCall };
  }
  return {
    rank: 2,
    label: `${plural(item.attempt_count, "call")} made`,
    tone: "bg-gray-100 text-gray-700",
    icon: PhoneCall,
  };
}

export default function MyWork({ canEdit }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [openSale, setOpenSale] = useState(null);

  const load = useCallback(() => {
    dataCenterAssign
      .myBatches()
      .then((r) => {
        setItems(r.items ?? []);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof DataCenterError ? err.message : "Could not load your queue."),
      );
  }, []);

  useEffect(load, [load]);

  const partners = useMemo(() => {
    if (!items) return [];
    const groups = new Map();
    for (const item of items) {
      const key = item.partner_name ?? "No partner";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => standing(a).rank - standing(b).rank);
    }
    // The partner with the most urgent record first, so the top of the page is
    // always the next thing to do.
    return [...groups.entries()].sort(
      (a, b) => standing(a[1][0]).rank - standing(b[1][0]).rank,
    );
  }, [items]);

  const totals = useMemo(() => {
    const list = items ?? [];
    return {
      all: list.length,
      todo: list.filter((i) => !i.attempt_count).length,
      urgent: list.filter((i) => i.serial_unconfirmed_at).length,
      done: list.filter((i) =>
        ["fully_verified", "partially_verified"].includes(i.verification_outcome),
      ).length,
    };
  }, [items]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-900">{error}</p>
      </div>
    );
  }

  if (!items) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your queue...
      </p>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/40 px-4 py-3">
          <Headphones className="h-4 w-4 text-(--dc-accent)" />
          <h2 className="text-sm font-semibold text-gray-900">My calls</h2>
          <span className="text-xs text-gray-600">
            everything assigned to you, most urgent first
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {totals.urgent > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                {totals.urgent} need the stove ID confirmed
              </span>
            )}
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
              {totals.todo} not called
            </span>
            <span className="rounded-full bg-(--dc-accent-soft) px-2.5 py-0.5 text-xs font-medium text-(--dc-accent-strong)">
              {totals.done} of {totals.all} done
            </span>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/15 p-6 text-center">
            <p className="text-sm font-medium text-gray-800">Nothing is assigned to you.</p>
            <p className="mt-1 text-sm text-gray-600">
              Work is handed out in batches of one partner at a time. If your queue
              is empty and you expect work, ask a supervisor to run the assignment
              or move some to you.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {partners.map(([partner, list]) => (
              <div key={partner}>
                <p className="flex flex-wrap items-baseline gap-2 bg-gray-50/80 px-4 py-2">
                  <span className="text-sm font-semibold text-gray-900">{partner}</span>
                  <span className="text-xs text-gray-600">
                    {plural(list.length, "record")}
                    {list.length > 1 ? " — one partner, one run of calls" : ""}
                  </span>
                </p>
                <ul className="divide-y divide-gray-50">
                  {list.map((item) => {
                    const state = standing(item);
                    const Icon = state.icon;
                    return (
                      <li key={item.sale_id}>
                        <button
                          type="button"
                          onClick={() => canEdit && setOpenSale(item.sale_id)}
                          disabled={!canEdit}
                          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition enabled:hover:bg-(--dc-accent-soft)/40 disabled:cursor-default"
                        >
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${state.tone}`}
                          >
                            <Icon className="h-3 w-3" /> {state.label}
                          </span>
                          <span className="font-mono text-sm font-semibold text-gray-900">
                            {item.stove_serial_no}
                          </span>
                          <span className="text-sm text-gray-700">
                            {item.end_user_name ?? "no name on the record"}
                          </span>
                          <span className="text-sm font-medium text-(--dc-accent-strong)">
                            {item.phone ?? "no number"}
                          </span>
                          {item.last_attempt_at && (
                            <span className="text-xs text-gray-500">
                              last rang {dateOf(item.last_attempt_at)}
                            </span>
                          )}
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            <Link
                              href={`/data-center/stove/${encodeURIComponent(item.stove_serial_no ?? "")}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs font-medium text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2"
                            >
                              Full history
                            </Link>
                            {canEdit && <ChevronRight className="h-4 w-4 text-gray-400" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {openSale && (
        <CallRecordEditor
          saleId={openSale}
          canEdit={canEdit}
          onClose={() => setOpenSale(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

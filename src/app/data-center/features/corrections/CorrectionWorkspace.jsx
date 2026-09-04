import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterCorrections, DataCenterError } from "../../lib/client";
import { dateOf } from "../../lib/when";
import { Loader2, AlertTriangle, ArrowLeft } from "lucide-react";
import DisputedRecord from "./DisputedRecord";
import SaleEditPanel from "./SaleEditPanel";
import SerialFixPanel from "./SerialFixPanel";
import ReviewPanel from "./ReviewPanel";
import CorrectionTimeline from "./CorrectionTimeline";

/**
 * One correction as a place to work.
 *
 * Left, the whole record with the disputed items marked. Right, the panel that
 * moves the episode: Sales edits the sale and sends it for review; the call
 * centre reviews and closes. Everything here is read through one `detail`
 * call and written through the sales app's own `update-sale` (the sale) or
 * the module's own actions (the episode, the stove ID), so nothing is edited
 * in two places.
 */

const STATE_PILL = {
  open: "bg-red-100 text-red-800",
  fixed: "bg-amber-100 text-amber-900",
  resolved: "bg-(--dc-accent-soft) text-(--dc-accent-strong)",
};
const STATE_WORD = { open: "Waiting on Sales", fixed: "Awaiting review", resolved: "Closed" };

export default function CorrectionWorkspace({ saleId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    dataCenterCorrections
      .detail(saleId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) =>
        setError(
          err instanceof DataCenterError
            ? err.code === "not_routed"
              ? "This record is not routed to you. Ask whoever runs the call centre to route it, or open it from the corrections list if you see everything."
              : err.message
            : "Could not load this correction.",
        ),
      );
  }, [saleId]);

  useEffect(load, [load]);

  const newest = data?.episodes?.[0] ?? null;
  const disputed = useMemo(() => new Set(newest?.disputed_fields ?? []), [newest]);

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-amber-200 border-t-[3px] border-t-amber-400 bg-amber-50 p-6">
        <AlertTriangle className="h-6 w-6 text-amber-600" />
        <h1 className="mt-3 text-base font-semibold text-amber-900">Nothing to work on here</h1>
        <p className="mt-1.5 text-sm text-amber-900">{error}</p>
        <Link
          href="/data-center/corrections"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong)"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the list
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the record...
      </p>
    );
  }

  if (!newest) {
    return (
      <div className="rounded-xl border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 p-8 text-center">
        <p className="text-sm font-medium text-gray-800">Nothing was sent back on this record.</p>
        <Link href="/data-center/corrections" className="mt-2 inline-block text-sm text-(--dc-accent)">
          Back to the list
        </Link>
      </div>
    );
  }

  const record = data.record ?? {};
  const serialDisputed = disputed.has("stove_serial_no");
  const showEdit = data.can.fix && newest.state === "open";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/data-center/corrections"
          className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/25 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
        >
          <ArrowLeft className="h-4 w-4" /> Corrections
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-gray-900">
            <span className="font-mono">{record.stove_serial_no ?? newest.stove_serial_no ?? "no stove ID"}</span>
            <span className="font-normal text-gray-500"> at </span>
            {record.partner_name ?? newest.partner_name ?? "unknown partner"}
          </h2>
          <p className="text-sm text-gray-600">
            Sent back {dateOf(newest.opened_at, "")}
            {newest.opened_by_name ? ` by ${newest.opened_by_name}` : ""}: <strong>{newest.reason_label ?? "no reason given"}</strong>.
            {newest.rep_account_name
              ? ` Routed to ${newest.rep_account_name}${newest.via_delegate ? " (delegate)" : ""}.`
              : " No account is linked for this rep; the standing recipients carry it."}
          </p>
        </div>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_PILL[newest.state]}`}>
          {STATE_WORD[newest.state]}
        </span>
        {disputed.size > 0 && (
          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
            {disputed.size} {disputed.size === 1 ? "field" : "fields"} disputed
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DisputedRecord data={data} episode={newest} disputed={disputed} />

        <div className="space-y-4">
          {showEdit && serialDisputed && (
            <SerialFixPanel saleId={saleId} currentSerial={record.stove_serial_no ?? null} onChanged={load} />
          )}
          {showEdit && (
            <SaleEditPanel
              saleId={saleId}
              sale={data.sale ?? {}}
              catalogue={data.catalogue}
              disputed={disputed}
              canEditSale={data.can.editSale}
              onlyNote={serialDisputed && disputed.size === 1}
              onSaved={load}
            />
          )}
          {!showEdit && newest.state === "open" && (
            <div className="rounded-xl border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/15 p-4 text-sm text-gray-700">
              This record is waiting on Sales. It is routed to{" "}
              {newest.rep_account_name ?? "the standing recipients"}; only they, or somebody who sees everything, can save the fix.
            </div>
          )}
          {(data.can.review || data.can.withdraw) && (
            <ReviewPanel
              saleId={saleId}
              episode={newest}
              catalogue={data.catalogue}
              can={data.can}
              history={data.history ?? []}
              phoneCheck={data.phoneCheck ?? null}
              onDone={load}
            />
          )}
          <CorrectionTimeline episodes={data.episodes} />
        </div>
      </div>
    </div>
  );
}

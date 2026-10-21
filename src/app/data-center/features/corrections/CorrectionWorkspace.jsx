import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { dataCenterCorrections, DataCenterError } from "../../lib/client";
import { useFeature } from "../../lib/access";
import { DATA_CENTER_FEATURES } from "../../lib/features";
import { dateOf } from "../../lib/when";
import { queryOf } from "./CorrectionFilters";
import { Loader2, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
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
 * the module's own actions (the episode, the serial number), so nothing is edited
 * in two places.
 *
 * Phase 34 (D67): the list's filters travel in the URL, so a saved fix says so
 * plainly and offers the next record waiting in the same list. On a phone the
 * fix panel comes first, above the record it fixes.
 */

/**
 * The next open record in the same narrowed list, after this one.
 *
 * Read through the list action, so "next" means exactly what the list shows,
 * filters and visibility included. Wraps to the top; null when this was the
 * last one.
 */
async function nextAfter(saleId, narrowing) {
  const r = await dataCenterCorrections.list({
    tab: "open",
    mine: Boolean(narrowing.mine),
    limit: 500,
    rep: narrowing.rep ?? null,
    partner: narrowing.partner ?? null,
    reason: narrowing.reason ?? null,
    q: narrowing.q ?? null,
  });
  const rows = (r.rows ?? []).filter((row) => r.canFix && (row.is_mine || r.seesEverything || row.assigned_to));
  const at = rows.findIndex((row) => row.sale_id === saleId);
  const after = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))].filter((row) => row.sale_id !== saleId);
  return after[0]?.sale_id ?? null;
}

const STATE_PILL = {
  open: "bg-red-100 text-red-800",
  fixed: "bg-amber-100 text-amber-900",
  resolved: "bg-(--dc-accent-soft) text-(--dc-accent-strong)",
};
const STATE_WORD = { open: "Waiting on Sales", fixed: "Awaiting review", resolved: "Closed" };

export default function CorrectionWorkspace({ saleId, narrowing = {} }) {
  const navigate = useNavigate();
  const { can } = useFeature();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [next, setNext] = useState({ busy: false, none: false });
  const listHref = `/data-center/corrections${queryOf(narrowing)}`;

  const goNext = async () => {
    setNext({ busy: true, none: false });
    try {
      const id = await nextAfter(saleId, narrowing);
      if (!id) {
        setNext({ busy: false, none: true });
        return;
      }
      navigate({ to: `/data-center/corrections/${encodeURIComponent(id)}${queryOf(narrowing)}` });
    } catch {
      setNext({ busy: false, none: false });
      setError("Could not find the next record. Go back to the list.");
    }
  };

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
          href={listHref}
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
        <Link href={listHref} className="mt-2 inline-block text-sm text-(--dc-accent)">
          Back to the list
        </Link>
      </div>
    );
  }

  const record = data.record ?? {};
  const serialDisputed = disputed.has("stove_serial_no");
  const showEdit = data.can.fix && newest.state === "open";
  // Fixing for somebody else is said before the save, not only after it (D67).
  const actingFor = showEdit && !data.can.mine ? newest.sales_rep ?? newest.rep_account_name ?? null : null;
  const nextButton = (filled) => (
    <button
      type="button"
      onClick={goNext}
      disabled={next.busy}
      className={
        filled
          ? "inline-flex h-10 items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
          : "inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/25 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
      }
    >
      {next.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {filled ? "Next record" : "Skip to next"} <ArrowRight className="h-4 w-4" />
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={listHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/25 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
        >
          <ArrowLeft className="h-4 w-4" /> Records to fix
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-gray-900">
            <span className="font-mono">{record.stove_serial_no ?? newest.stove_serial_no ?? "no serial number"}</span>
            <span className="font-normal text-gray-500"> at </span>
            {record.partner_name ?? newest.partner_name ?? "unknown partner"}
          </h2>
          <p className="text-sm text-gray-600">
            Sent back {dateOf(newest.opened_at, "")}
            {newest.opened_by_name ? ` by ${newest.opened_by_name}` : ""}: <strong>{newest.reason_label ?? "no reason given"}</strong>.
            {newest.rep_account_name
              ? ` Routed to ${newest.rep_account_name}${newest.via_delegate ? " (delegate)" : ""}.`
              : " No account is linked for this rep; the standing recipients carry it."}
            {can(DATA_CENTER_FEATURES.RECORDS_VIEW) && (record.stove_serial_no ?? newest.stove_serial_no) && (
              <>
                {" "}
                <Link
                  href={`/data-center/stove/${encodeURIComponent(record.stove_serial_no ?? newest.stove_serial_no)}`}
                  className="text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2"
                >
                  Stove record
                </Link>
              </>
            )}
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
        {showEdit && !saved && nextButton(false)}
      </div>

      {saved && (
        <div
          role="status"
          data-correction-saved
          className="flex flex-wrap items-center gap-3 rounded-xl border border-(--dc-accent)/30 bg-(--dc-accent-soft)/40 px-4 py-3"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-(--dc-accent)" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Sent for review</p>
            <p className="text-sm text-gray-700">
              {next.none
                ? "That was the last record waiting in this list."
                : "The call centre checks it before ringing again. The next record is one click away."}
            </p>
          </div>
          {next.none ? (
            <Link
              href={listHref}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong)"
            >
              <ArrowLeft className="h-4 w-4" /> Back to the list
            </Link>
          ) : (
            nextButton(true)
          )}
        </div>
      )}

      {actingFor && (
        <p className="rounded-lg border border-(--dc-accent)/20 bg-white px-3 py-2 text-sm text-gray-700">
          You are fixing this for <strong>{actingFor}</strong>. The record will say you made the change on their behalf.
        </p>
      )}

      {!saved && next.none && (
        <p className="text-sm text-gray-600">That was the last record waiting in this list.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="order-2 lg:order-1">
          <DisputedRecord data={data} episode={newest} disputed={disputed} />
        </div>

        <div className="order-1 space-y-4 lg:order-2">
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
              onSaved={() => {
                setSaved(true);
                load();
              }}
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

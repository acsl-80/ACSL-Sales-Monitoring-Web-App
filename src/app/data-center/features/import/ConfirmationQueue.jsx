import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { usePaged } from "../../lib/usePaged";
import Pagination from "../../components/Pagination";
import ExportButton from "../../components/ExportButton";
import { plural } from "../../lib/plural";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, ShieldCheck, Upload, PenLine, TriangleAlert, Clock, CheckCircle2, Lock,
} from "lucide-react";

/**
 * What has been entered and not yet let through.
 *
 * Nothing reaches the sales app because somebody typed it or uploaded it. It
 * reaches the sales app because somebody confirmed it, and this is where that
 * happens. Until then a record exists here and nowhere else, which is the
 * point: a mistake caught at this desk costs a correction, and the same
 * mistake past it costs a call to a buyer who never bought anything.
 *
 * The two streams are drawn apart on purpose. A file of four hundred rows and
 * eleven receipts somebody typed this morning are different decisions - one is
 * a judgement about a spreadsheet, the other about a person's work - and a
 * single queue with one button over it would flatten them into the same
 * gesture.
 */

const whenOf = (v) => (v ? new Date(v).toLocaleString() : "-");

const STREAMS = [
  {
    key: "bulk_import",
    title: "Uploaded in bulk",
    icon: Upload,
    blurb: "Spreadsheets somebody filled in away from the app.",
    empty: "No uploaded batches are waiting.",
  },
  {
    key: "workbench",
    title: "Typed at the bench",
    icon: PenLine,
    blurb: "Receipts worked one at a time, grouped by who typed them.",
    empty: "Nothing has been typed and finished yet.",
  },
];

const COLUMNS = [
  { key: "stream", label: "Stream" },
  { key: "partner_name", label: "Partner" },
  { key: "filename", label: "File", get: (r) => r.filename ?? "typed at the bench" },
  { key: "uploaded_by_name", label: "Entered by" },
  { key: "worked_by", label: "Worked by", get: (r) => (r.worked_by ?? []).join(" / ") },
  { key: "awaiting", label: "Waiting to confirm" },
  { key: "still_drafting", label: "Still being typed" },
  { key: "refused", label: "Refused" },
  { key: "exceptions", label: "Exceptions" },
  { key: "confirmed", label: "Already confirmed" },
  { key: "uploaded_at", label: "Entered at" },
  { key: "last_worked_on", label: "Last worked on" },
];

function StreamTable({ stream, rows, canConfirm, onConfirm, onOpenBench, busy }) {
  const paged = usePaged(rows, 10);
  const Icon = stream.icon;
  const waiting = rows.reduce((n, r) => n + Number(r.awaiting ?? 0), 0);
  const drafting = rows.reduce((n, r) => n + Number(r.still_drafting ?? 0), 0);
  const refused = rows.reduce(
    (n, r) => n + Number(r.refused ?? 0) + Number(r.exceptions ?? 0),
    0,
  );
  /*
   * The bench stream can point at the bench. A row with nothing waiting used
   * to show a greyed "Confirm 0" and nothing else, and the person looking at
   * twenty-seven drafts had no idea what to press next: a draft is finished
   * at the bench, and so is a refused receipt. The action column exists when
   * either action can be offered, not only for people who can confirm.
   */
  const canPoint = stream.key === "workbench" && typeof onOpenBench === "function";
  const showActions = canConfirm || canPoint;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <Icon className="h-4 w-4 text-(--dc-accent)" />
        <h3 className="text-sm font-semibold text-gray-900">{stream.title}</h3>
        <span className="text-xs text-gray-600">{stream.blurb}</span>
        <span className="ml-auto text-sm tabular-nums text-gray-700">
          {plural(waiting, "record")} waiting
          {drafting > 0 ? `, ${drafting} still being typed` : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 px-4 py-6 text-center text-sm text-gray-600">
          {stream.empty}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-left text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2">{stream.key === "workbench" ? "Typed by" : "File"}</th>
                  <th className="px-3 py-2">Partner</th>
                  <th className="px-3 py-2 text-right">Waiting</th>
                  <th className="px-3 py-2 text-right">Drafting</th>
                  <th className="px-3 py-2 text-right">Needs a look</th>
                  <th className="px-3 py-2">Last worked on</th>
                  {showActions && <th className="w-36 px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((r) => {
                  const needsLook = Number(r.refused ?? 0) + Number(r.exceptions ?? 0);
                  return (
                    <tr key={r.batch_id} className="transition hover:bg-(--dc-accent-soft)/40">
                      <td className="max-w-[16rem] truncate px-3 py-2">
                        <span className="block font-medium text-gray-900">
                          {stream.key === "workbench"
                            ? (r.worked_by?.[0] ?? r.uploaded_by_name ?? "somebody")
                            : (r.filename ?? "(no filename)")}
                        </span>
                        {stream.key !== "workbench" && r.uploaded_by_name && (
                          <span className="block text-xs text-gray-600">
                            uploaded by {r.uploaded_by_name}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-gray-700">
                        {r.partner_name ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                        {r.awaiting}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {r.still_drafting}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          needsLook > 0 ? "font-medium text-amber-700" : "text-gray-500"
                        }`}
                      >
                        {needsLook}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                        {whenOf(r.last_worked_on ?? r.uploaded_at)}
                      </td>
                      {showActions && Number(r.awaiting) === 0 && canPoint &&
                        (Number(r.still_drafting ?? 0) > 0 || needsLook > 0) && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => onOpenBench(r)}
                            title={
                              needsLook > 0
                                ? "Refused receipts are fixed at the bench, then saved as finished again."
                                : "Drafts are finished at the bench by the person typing them."
                            }
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-(--dc-accent)/40 px-2.5 py-1 text-xs font-medium text-(--dc-accent-strong) transition hover:bg-(--dc-accent-soft)/50"
                          >
                            <PenLine className="h-3.5 w-3.5" /> Open the bench
                          </button>
                        </td>
                      )}
                      {showActions && Number(r.awaiting) === 0 && !(canPoint &&
                        (Number(r.still_drafting ?? 0) > 0 || needsLook > 0)) && (
                        <td className="px-3 py-2" />
                      )}
                      {showActions && Number(r.awaiting) > 0 && canConfirm && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onConfirm(r)}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm {r.awaiting}
                          </button>
                        </td>
                      )}
                      {showActions && Number(r.awaiting) > 0 && !canConfirm && (
                        <td className="px-3 py-2" />
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="batch"
          />
          {stream.key === "workbench" && (drafting > 0 || refused > 0) && (
            <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-600">
              Confirm releases finished receipts only.
              {drafting > 0 &&
                ` ${plural(drafting, "draft is", "drafts are")} still being typed and ${
                  drafting === 1 ? "is" : "are"
                } finished at the bench, by the person typing.`}
              {refused > 0 &&
                ` ${plural(refused, "receipt was", "receipts were")} refused; each is opened at the bench, where the reason is shown, fixed and saved as finished again.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function ConfirmationQueue({ canConfirm, onOpenBench = null }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  // Read by the event listeners below, which are bound once and would
  // otherwise see the busy flag as it stood when they were bound.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const load = useCallback(async () => {
    try {
      const out = await dataCenterImport.awaitingConfirmation();
      setRows(out.batches);
      setError(null);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "Could not load what is waiting.",
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Refreshed when somebody comes back to look, not only when it mounts.
   *
   * This queue is the desk other people's work arrives at, so its numbers go
   * stale by nature: a typist finishes receipts in another tab, an upload
   * lands in another window, and a mount-time snapshot quietly stops being
   * true. Focus and visibility cover coming back from anywhere; the bench's
   * own finish event covers the tab switch that never blurs the window.
   * Nothing refreshes mid-confirmation - the poll in `confirm` owns the
   * screen while it runs.
   */
  useEffect(() => {
    const refresh = () => {
      if (!busyRef.current) load();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("data-center:bench-finished", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("data-center:bench-finished", refresh);
    };
  }, [load]);

  const byStream = useMemo(() => {
    const out = { bulk_import: [], workbench: [] };
    for (const r of rows ?? []) (out[r.stream] ?? out.bulk_import).push(r);
    return out;
  }, [rows]);

  const totalWaiting = (rows ?? []).reduce((n, r) => n + Number(r.awaiting ?? 0), 0);

  /**
   * Confirming is committing.
   *
   * The commit path already claims the stove under lock and writes through
   * create-sale, so this adds no second way for a record to land. What it adds
   * is the decision, and who made it.
   */
  const confirm = async (batch) => {
    setBusy(true);
    setNotice(null);
    try {
      /*
       * Same driver as the import panel: kick once, the server chains itself,
       * and this watches the batch's live counts. This used to be a second,
       * independent commit loop - two drivers over one batch is exactly the
       * overlap that used to burn rows into exceptions.
       */
      const kick = await dataCenterImport.commit(batch.batch_id);
      let done = kick.committed ?? 0;
      if (!(kick.done && !kick.started)) {
        for (;;) {
          await new Promise((r) => setTimeout(r, 4000));
          const rows = await dataCenterImport.batches({ batchId: batch.batch_id });
          const b = rows.find((x) => x.id === batch.batch_id);
          if (!b) break;
          done = b.committed_rows;
          if (b.state === "committed" || b.valid_rows === 0) break;
          if (!b.committing) {
            throw new DataCenterError(
              b.last_error ?? "The write paused. Confirm again to continue.",
              408,
              "stalled",
            );
          }
        }
      }
      setNotice(
        `${plural(done, "record")} confirmed and sent to the sales app` +
          (batch.partner_name ? ` for ${batch.partner_name}` : "") + ".",
      );
      await load();
    } catch (err) {
      setError(
        err instanceof DataCenterError
          ? err.message
          : "Confirmation stopped early. Ask again to carry on from where it reached.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (rows === null && !error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 text-sm text-gray-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading what is waiting...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-(--dc-accent)" />
              <h2 className="text-sm font-semibold text-gray-900">Waiting to be confirmed</h2>
            </div>
            <p className="text-sm text-gray-600">
              {totalWaiting > 0
                ? `${plural(totalWaiting, "record")} have been entered and are not in the sales app yet.`
                : "Nothing is waiting. Everything entered has been confirmed."}{" "}
              A record reaches the sales app because somebody released it, not
              because somebody typed it.
            </p>
          </div>
          <ExportButton
            columns={COLUMNS}
            rows={() => rows ?? []}
            filename="awaiting-confirmation.csv"
            label="Export queue"
            disabled={(rows ?? []).length === 0}
          />
        </div>

        {!canConfirm && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-(--dc-surface-muted) p-3 text-sm text-gray-700">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
            You can see what is waiting but not release it. Releasing needs the
            import.commit permission, which is deliberately separate from being
            able to enter records.
          </p>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/40 p-3 text-sm text-(--dc-accent-strong)">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </p>
        )}
        {busy && (
          <p className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <Clock className="h-4 w-4 animate-pulse" /> Confirming. Large batches
            go through in slices, so this can take a moment.
          </p>
        )}
      </div>

      {STREAMS.map((stream) => (
        <StreamTable
          key={stream.key}
          stream={stream}
          rows={byStream[stream.key] ?? []}
          canConfirm={canConfirm}
          busy={busy}
          onConfirm={setPending}
          onOpenBench={onOpenBench}
        />
      ))}

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="dc-root" data-area="import">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send {pending ? plural(pending.awaiting, "record") : "these"} to the sales app?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.partner_name ? `${pending.partner_name}. ` : ""}
              Each one becomes a sale, and the stove it names moves from
              available to sold. It can be rolled back afterwards, but the
              buyers will be in the calling queue by then.
              {Number(pending?.refused ?? 0) + Number(pending?.exceptions ?? 0) > 0 && (
                <>
                  {" "}
                  The {Number(pending?.refused ?? 0) + Number(pending?.exceptions ?? 0)} rows
                  that still need a look are not included and stay where they are.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const batch = pending;
                setPending(null);
                if (batch) confirm(batch);
              }}
            >
              Confirm and send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

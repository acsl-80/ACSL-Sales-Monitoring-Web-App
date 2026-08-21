import { useCallback, useEffect, useMemo, useState } from "react";
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

function StreamTable({ stream, rows, canConfirm, onConfirm, busy }) {
  const paged = usePaged(rows, 10);
  const Icon = stream.icon;
  const waiting = rows.reduce((n, r) => n + Number(r.awaiting ?? 0), 0);
  const drafting = rows.reduce((n, r) => n + Number(r.still_drafting ?? 0), 0);

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
                  {canConfirm && <th className="w-32 px-3 py-2" />}
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
                      {canConfirm && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={busy || Number(r.awaiting) === 0}
                            onClick={() => onConfirm(r)}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm {r.awaiting}
                          </button>
                        </td>
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
        </>
      )}
    </section>
  );
}

export default function ConfirmationQueue({ canConfirm }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

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
      let done = 0;
      // The server commits in slices so a large batch does not run inside one
      // request. Asking again until it says it is finished is how the existing
      // commit button works, and this is the same act.
      for (let pass = 0; pass < 200; pass++) {
        const out = await dataCenterImport.commit(batch.batch_id);
        done += out.committed ?? 0;
        if (out.done) break;
        if ((out.committed ?? 0) === 0 && (out.failed ?? 0) === 0) break;
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

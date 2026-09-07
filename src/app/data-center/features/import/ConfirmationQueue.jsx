import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import ExportButton from "../../components/ExportButton";
import ImportFigures from "./parts/ImportFigures";
import ConfirmationStream from "./ConfirmationStream";
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
  Loader2, ShieldCheck, Upload, PenLine, TriangleAlert, CheckCircle2, Clock, Lock,
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
 *
 * The figures, the search and the source chips are all read over the same
 * `awaitingConfirmation()` rows the streams already hold: no new endpoint, no
 * second request, just a different look at the one list (import redesign,
 * 2026-09-07).
 */

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

const SOURCE_CHIPS = [
  { key: "all", label: "All" },
  { key: "bulk_import", label: "Files" },
  { key: "workbench", label: "Bench" },
];

export default function ConfirmationQueue({ canConfirm, onOpenBench = null }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [typedBy, setTypedBy] = useState("all");
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
   * The four counts over the whole loaded list, unfiltered.
   *
   * The strip says what is actually waiting; narrowing it by the search or the
   * source chips would make the numbers answer the filter rather than the
   * queue, which is the same trap a scorecard under a forgotten filter falls
   * into. `null` while the read has not landed or has failed, so a stalled
   * queue never shows a false zero.
   */
  const figureTotals = useMemo(() => {
    if (rows === null) return null;
    let bulkWaiting = 0;
    let benchWaiting = 0;
    let drafting = 0;
    let needLook = 0;
    for (const r of rows) {
      const awaiting = Number(r.awaiting ?? 0);
      if (r.stream === "workbench") benchWaiting += awaiting;
      else bulkWaiting += awaiting;
      drafting += Number(r.still_drafting ?? 0);
      needLook += Number(r.refused ?? 0) + Number(r.exceptions ?? 0);
    }
    return { bulkWaiting, benchWaiting, drafting, needLook };
  }, [rows]);

  const figures = [
    {
      key: "bulk_waiting",
      value: figureTotals?.bulkWaiting ?? null,
      label: "uploaded in bulk, waiting",
      href: null,
      tone: "verified",
    },
    {
      key: "bench_waiting",
      value: figureTotals?.benchWaiting ?? null,
      label: "typed at the bench, waiting",
      href: null,
      tone: "verified",
    },
    {
      key: "drafting",
      value: figureTotals?.drafting ?? null,
      label: "still being drafted",
      href: null,
      tone: "transferred",
    },
    {
      key: "need_look",
      value: figureTotals?.needLook ?? null,
      label: "need a look first",
      href: null,
      tone: "unverified",
    },
  ];

  /** Everyone who has typed a bench batch still waiting, for the "Typed by" filter. */
  const benchTypists = useMemo(
    () => Array.from(new Set((byStream.workbench ?? []).flatMap((r) => r.worked_by ?? []))).sort(),
    [byStream],
  );
  const showTypedBy = benchTypists.length > 1;

  /** Client-side over the rows already loaded, the way the period filter works today. */
  const filteredByStream = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byPartner = (r) => !q || (r.partner_name ?? "").toLowerCase().includes(q);
    const bulk = source === "workbench" ? [] : (byStream.bulk_import ?? []).filter(byPartner);
    let bench = source === "bulk_import" ? [] : (byStream.workbench ?? []).filter(byPartner);
    if (showTypedBy && typedBy !== "all") {
      bench = bench.filter((r) => (r.worked_by ?? []).includes(typedBy));
    }
    return { bulk_import: bulk, workbench: bench };
  }, [byStream, search, source, typedBy, showTypedBy]);

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

        <ImportFigures figures={figures} compact className="mt-4" />

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
          <div className="w-full sm:w-56">
            <label
              htmlFor="cq-partner-search"
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
            >
              Partner
            </label>
            <input
              id="cq-partner-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Partner"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              Source
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_CHIPS.map((c) => {
                const on = source === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSource(c.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      on
                        ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                        : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/30"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {showTypedBy && (
            <div className="w-full sm:w-auto">
              <label
                htmlFor="cq-typed-by"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
              >
                Typed by
              </label>
              <select
                id="cq-typed-by"
                value={typedBy}
                onChange={(e) => setTypedBy(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none sm:w-auto"
              >
                <option value="all">Anyone</option>
                {benchTypists.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {STREAMS.map((stream) => (
        <ConfirmationStream
          key={stream.key}
          stream={stream}
          rows={filteredByStream[stream.key] ?? []}
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

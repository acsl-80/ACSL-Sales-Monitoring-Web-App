import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PeriodFilter from "../../components/PeriodFilter";
import { usePeriod } from "../../lib/usePeriod";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { parseCsv, CsvError } from "../../lib/csv";
import { parseWorkbook, canReadWorkbooks, looksLikeWorkbook } from "../../lib/xlsx";
import ColumnMapping from "./ColumnMapping";
import ManualEntry from "./ManualEntry";
import RejectedRows from "./RejectedRows";
import { plural } from "../../lib/plural";
import Pagination from "../../components/Pagination";
import Unlanded, { groupUnlanded } from "../../components/Unlanded";
import { usePaged } from "../../lib/usePaged";
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
  Upload, Loader2, AlertTriangle, CheckCircle2, FileText, Play,
  Eye, Undo2, Wrench, X, PenLine, Copy, ChevronDown, ChevronRight,
} from "lucide-react";

/**
 * Bulk import of digitalized paper receipts.
 *
 * The UI is deliberately four steps rather than one button, because committing
 * marks hundreds of stoves sold and changes the sales app's own inventory
 * figures. Every step says what it is about to do before it does it.
 *
 * The exceptions queue is not an error screen. Roughly one serial in twelve
 * does not match stock in a real workbook, and a person with the receipt in
 * front of them can usually fix it. That is the normal path.
 */

const NUMBER = new Intl.NumberFormat("en-NG");

const STATE_TONE = {
  staged: "bg-gray-100 text-gray-700",
  validated: "bg-blue-100 text-blue-800",
  dry_run: "bg-amber-100 text-amber-800",
  committed: "bg-(--dc-primary)/10 text-(--dc-accent)",
  rolled_back: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-700",
};

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/30 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Stoves in this batch sharing a phone number with another stove.
 *
 * One household, one number, two stoves is ordinary and allowed - so these
 * rows are valid and never reach the exceptions queue. A mistyped digit
 * repeated across a batch is also valid, and looks identical, so the only
 * useful thing the system can do is put the two in front of the person who
 * can tell them apart before anything commits.
 *
 * Amber rather than red on purpose: nothing here is wrong yet.
 */
function SharedPhoneRows({ batchId }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let live = true;
    dataCenterImport
      .sharedPhoneRows(batchId)
      .then((r) => live && setRows(r))
      // A flag that could not be loaded must not take the batch down with it.
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [batchId]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="border-t border-amber-200 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <AlertTriangle className="h-4 w-4" />
        {rows.length === 1
          ? "One stove here shares a phone number with another"
          : `${rows.length} stoves here share a phone number with another`}
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        Allowed: a household can buy more than one. Check these are a family and
        not the same number typed twice. Nothing is blocked either way.
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-amber-900">
            <span className="text-xs text-amber-700">row {r.row_number}</span>
            <span className="font-mono font-medium">{r.stove_serial_no ?? "-"}</span>
            <span className="text-xs">shares with</span>
            {(r.shared_phone_with ?? []).map((other) => (
              <span
                key={other}
                className="rounded border border-amber-400 bg-white px-1.5 py-0.5 font-mono text-xs"
              >
                {other}
              </span>
            ))}
            {r.normalized?.phone ? (
              <span className="text-xs text-amber-700">on {String(r.normalized.phone)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExceptionsQueue({ batchId, canResolve, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await dataCenterImport.rows(batchId, "exception"));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (rowId) => {
    const serial = (drafts[rowId] ?? "").trim();
    if (!serial) return;
    setBusy(rowId);
    try {
      const out = await dataCenterImport.resolveException(rowId, serial);
      if (!out.resolved) {
        // The correction did not fix it. Say so here rather than letting the
        // row look resolved and fail later at commit.
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, exception_reason: out.reason } : r)));
      } else {
        await load();
        onChanged?.();
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading exceptions...
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-gray-500">No exceptions in this batch.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="w-10 shrink-0 text-xs text-gray-400">#{r.row_number}</span>
          <span className="min-w-[180px] flex-1 text-amber-800">{r.exception_reason}</span>
          <span className="shrink-0 text-xs text-gray-500">
            {r.raw?.["User First Name"] ?? r.raw?.end_user_name ?? r.raw?.name ?? ""}
          </span>
          {canResolve && (
            <>
              <input
                type="text"
                value={drafts[r.id] ?? r.stove_serial_no ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                placeholder="Correct serial"
                className="w-full min-w-0 rounded-md border sm:w-36 border-gray-300 px-2 py-1 text-sm focus:border-(--dc-accent) focus:outline-none"
              />
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => resolve(r.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--dc-primary)/30 px-2 py-1 text-xs font-medium text-(--dc-primary) hover:bg-(--dc-primary)/10 disabled:opacity-50"
              >
                {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                Fix
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the import is doing, while it does it.
 *
 * A bulk import was one spinner and then one long sentence. On four hundred
 * rows that is thirty seconds of blank screen followed by a paragraph, and the
 * two questions people actually have during it - is it stuck, and is it going
 * to work - had no answer until it was over.
 *
 * Each step says what it is for in plain words, because "validate" means
 * nothing to somebody holding a stack of receipts.
 */
function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="space-y-1.5 border-b border-gray-100 px-4 py-3">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 shrink-0">
            {s.state === "running" && <Loader2 className="h-4 w-4 animate-spin text-(--dc-accent)" />}
            {s.state === "done" && <CheckCircle2 className="h-4 w-4 text-(--dc-accent)" />}
            {s.state === "failed" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
            {s.state === "pending" && (
              <span className="block h-4 w-4 rounded-full border border-gray-300" />
            )}
          </span>
          <span className="min-w-0">
            <span
              className={
                s.state === "pending"
                  ? "text-gray-400"
                  : s.state === "failed"
                    ? "font-medium text-amber-900"
                    : "text-gray-800"
              }
            >
              {s.label}
            </span>
            {s.detail && <span className="block text-xs text-gray-600">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function ImportPanel({ canUpload, canCommit, canResolve }) {
  const [batches, setBatches] = useState([]);
  // The history grows for as long as the module runs, so it pages.
  // A year of daily imports is a list nobody scrolls.

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  /** What the import is doing now, and what it did. Survives `busy` clearing. */
  const [steps, setSteps] = useState(null);
  const [unlanded, setUnlanded] = useState(null);

  /** Move one step along without rebuilding the list at every call site. */
  const stepTo = useCallback((key, state, detail = null) => {
    setSteps((list) =>
      (list ?? []).map((s) => (s.key === key ? { ...s, state, detail } : s)),
    );
  }, []);

  /**
   * The rows that did not land, grouped by why.
   *
   * Read back from the batch rather than from the commit response, because a
   * row can fail at two different moments - checking, and writing - and the
   * person reading this does not care which. One list, whatever stopped it.
   */
  const collectUnlanded = useCallback(async (batchId) => {
    const groups = await groupUnlanded(batchId);
    setUnlanded(groups.length ? groups : null);
    return groups;
  }, []);
  const [open, setOpen] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  // A file held between inspection and staging, while the operator maps its
  // strays. Null whenever there is nothing to decide.
  const [pendingFile, setPendingFile] = useState(null);
  // A staged upload refused as a repeat. Holds what it takes to send it again.
  const [duplicate, setDuplicate] = useState(null);
  const [manual, setManual] = useState(false);
  // The two irreversible actions, held until confirmed. window.confirm did this
  // job and did it in the browser's own voice, with no room to say what
  // changes and no way to look like the rest of the module.
  const [pending, setPending] = useState(null);
  const fileInput = useRef(null);

  /**
   * The history takes the same period as everything else, on upload date. It
   * is the surface most likely to be asked "what came in last week", and it
   * was the one that could only answer "here are the last fifty".
   */
  const { period, setPeriod, resolved, earliest } = usePeriod("/data-center/import");

  const refresh = useCallback(async () => {
    try {
      setBatches(await dataCenterImport.batches({
        ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
        ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
      }));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load import batches.");
    } finally {
      setLoading(false);
    }
  }, [resolved.dateFrom, resolved.dateTo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Stage a parsed file, then validate it.
   *
   * Split out from onFile because three paths reach it: a clean file straight
   * through, a mapped file after the operator has placed its stray columns,
   * and a repeat upload they have confirmed.
   */
  const stageAndValidate = useCallback(
    async (file, options = {}) => {
      setBusy(true);
      setNotice(null);
      setUnlanded(null);
      /*
       * Named in the words of the job, not of the code.
       *
       * "Validate" means nothing to somebody holding a stack of receipts. What
       * they want to know is whether the stove IDs were recognised and whether
       * anything is wrong before it is written, so that is what the steps say.
       */
      setSteps([
        { key: "read", label: `Reading ${file.name}`, state: "running",
          detail: `${plural(file.rows.length, "row")}` },
        { key: "partner", label: "Working out which partner each stove belongs to",
          state: "pending", detail: null },
        { key: "check", label: "Checking every row against the stove register",
          state: "pending", detail: null },
        { key: "ready", label: "Ready to commit", state: "pending", detail: null },
      ]);
      try {
        stepTo("read", "done", `${plural(file.rows.length, "row")} read`);
        stepTo("partner", "running");
        // No partner is sent. The stove IDs in the file name it, and the
        // server says which one it worked out.
        const staged = await dataCenterImport.stage(null, file.name, file.rows, options);
        const { batchId, resolvedPartner } = staged;
        stepTo(
          "partner",
          "done",
          resolvedPartner?.partners?.length > 1
            ? `${resolvedPartner.partners.length} partners: ` +
              resolvedPartner.partners
                .map((p) =>
                  `${[p.partnerName ?? "Unknown", p.branch].filter(Boolean).join(", ")} (${p.count})`,
                )
                .join("; ")
            : (resolvedPartner?.partnerName ?? "one partner"),
        );
        stepTo("check", "running");
        const counts = await dataCenterImport.validate(batchId);
        stepTo(
          "check",
          "done",
          `${counts.valid} ready, ${counts.exception} need a look, ` +
            `${counts.rejected} could not be read`,
        );
        // What is wrong, grouped, before anybody presses commit rather than
        // after. The whole point of staging is that this is cheap to look at.
        await collectUnlanded(batchId);
        stepTo(
          "ready",
          counts.valid > 0 ? "done" : "failed",
          counts.valid > 0
            ? `${plural(counts.valid, "row")} will be written when you commit`
            : "Nothing in this file can be written as it stands",
        );
        setNotice(
          `${file.name}: ${file.rows.length} rows staged` +
            /*
             * One partner reads as "for X". Several has to say so, or the
             * operator is told the file is one partner's when it is not.
             */
            (resolvedPartner?.partners?.length > 1
              ? ` across ${resolvedPartner.partners.length} partners: ` +
                resolvedPartner.partners
                  .map((p) =>
                    `${[p.partnerName ?? "Unknown", p.branch].filter(Boolean).join(", ")} (${p.count})`,
                  )
                  .join("; ")
              : resolvedPartner?.partnerName
                ? ` for ${resolvedPartner.partnerName}`
                : "") +
            `. ${counts.valid} ready, ${counts.exception} need a look, ` +
            `${counts.rejected} could not be read. ` +
            `${counts.linkedToTransfer} matched to a transfer.` +
            (resolvedPartner?.mismatches?.length
              ? ` ${resolvedPartner.mismatches.length} row(s) carry a transfer reference that does not match the stove.`
              : "") +
            (file.warnings?.length ? ` ${file.warnings[0]}` : ""),
        );
        setError(null);
        setPendingFile(null);
        setDuplicate(null);
        await refresh();
        setOpen(batchId);
      } catch (err) {
        // A repeat upload is a warning, not a failure. Hold what it takes to
        // send it again, because the legitimate case is real: a partner can
        // return the same serials after a correction.
        if (err instanceof DataCenterError && err.code === "duplicate_upload") {
          setDuplicate({ file, options, message: err.message });
          setError(null);
        } else {
          setError(
            err instanceof DataCenterError ? err.message : "Could not stage that file.",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setNotice(null);
    setDuplicate(null);
    try {
      /**
       * A workbook or a CSV, the same validator behind both.
       *
       * The sheet this module hands out is a workbook, because a CSV cannot
       * carry a dropdown. It has to come back as one, and both parsers return
       * the same shape so nothing downstream knows which it was.
       */
      // What it is, not what it is called. See looksLikeWorkbook.
      const isWorkbook = await looksLikeWorkbook(file);
      if (isWorkbook && !canReadWorkbooks()) {
        setError(
          "This browser cannot open .xlsx files. Save the sheet as CSV from your " +
            "spreadsheet program and upload that instead - the columns are the same.",
        );
        setBusy(false);
        return;
      }
      const parsed = isWorkbook
        ? await parseWorkbook(file)
        : parseCsv(await file.text());
      const held = {
        name: file.name,
        rows: parsed.rows,
        warnings: parsed.warnings,
        rowCount: parsed.rows.length,
      };
      const inspection = await dataCenterImport.inspect(parsed.headers);

      // Only stop when there is something to decide. A file whose columns are
      // all understood goes straight through: a confirmation nobody can fail
      // is a click that trains people to click.
      if (
        inspection.unrecognised.length === 0 &&
        inspection.missingRequired.length === 0 &&
        held.rowCount <= inspection.maxRows
      ) {
        await stageAndValidate(held);
      } else {
        setPendingFile({ file: held, inspection });
        setError(null);
      }
    } catch (err) {
      setError(
        err instanceof CsvError || err instanceof DataCenterError
          ? err.message
          : "Could not read that file.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async (record) => {
    setBusy(true);
    setNotice(null);
    try {
      const { batchId } = await dataCenterImport.manualEntry(null, record);
      const counts = await dataCenterImport.validate(batchId);
      setNotice(
        counts.valid === 1
          ? "Record staged and ready to commit."
          : counts.exception === 1
            ? "Record staged, and it needs a look before it can be committed."
            : "Record staged, and it could not be read.",
      );
      setError(null);
      setManual(false);
      await refresh();
      setOpen(batchId);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "Could not stage that record.",
      );
    } finally {
      setBusy(false);
    }
  };

  const runDryRun = async (batchId) => {
    setBusy(true);
    try {
      setDryRun(await dataCenterImport.dryRun(batchId));
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Dry run failed.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Commit, one slice at a time, until the batch is done.
   *
   * The loop lives here rather than on the server so no single request runs
   * long and the operator can watch it move. A failure stops the loop with the
   * batch part-committed, which is recoverable: asking again resumes.
   */
  const runCommit = async (batchId, total) => {
    setBusy(true);
    setProgress({ done: 0, failed: 0 });
    setUnlanded(null);
    setSteps([
      { key: "write", label: "Writing the sales", state: "running", detail: `0 of ${total}` },
      { key: "settled", label: "Finished", state: "pending", detail: null },
    ]);
    let done = 0;
    try {
      for (;;) {
        const out = await dataCenterImport.commit(batchId);
        done += out.committed;
        setProgress((p) => ({
          done: (p?.done ?? 0) + out.committed,
          failed: (p?.failed ?? 0) + out.failed,
        }));
        stepTo("write", "running", `${done} of ${total}`);
        if (out.done) break;
        if (out.committed === 0 && out.failed === 0) break;
      }
      stepTo("write", "done", `${plural(done, "sale")} written`);

      /*
       * What did not land, said out loud.
       *
       * This used to read "Commit finished." over any number of rows that did
       * not, while the server had been returning a reason for each one all
       * along. A count of successes is not a result; the result is what
       * happened to every row.
       */
      const groups = await collectUnlanded(batchId);
      const missed = groups.reduce((n, g) => n + g.rows.length, 0);
      stepTo(
        "settled",
        missed ? "failed" : "done",
        missed
          ? `${plural(missed, "row")} did not go in. They are listed below.`
          : "Every row went in.",
      );
      setNotice(missed ? null : `Commit finished. ${plural(done, "sale")} written.`);
      await refresh();
    } catch (err) {
      stepTo("write", "failed", "Stopped part way. Asking again resumes where it left off.");
      await collectUnlanded(batchId);
      setError(err instanceof DataCenterError ? err.message : "Commit stopped early. Ask again to resume.");
    } finally {
      setBusy(false);
    }
  };

  const runRollback = async (batchId, committed) => {
    setBusy(true);
    setProgress({ done: 0, failed: 0 });
    try {
      for (;;) {
        const out = await dataCenterImport.rollback(batchId);
        setProgress((p) => ({ done: (p?.done ?? 0) + out.reversed, failed: p?.failed ?? 0 }));
        if (out.done || out.reversed === 0) break;
      }
      setNotice("Rolled back.");
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Rollback stopped early.");
    } finally {
      setBusy(false);
    }
  };


  /**
   * What the two irreversible actions are about to do, in the module's own
   * voice rather than the browser's.
   *
   * Both change the sales app's inventory, which is the reason they are
   * confirmed at all. Compact and centred: a two-button question stretched to
   * fill the screen reads as an error, not a question.
   */
  const confirmCopy = pending?.kind === "commit"
    ? {
      title: `Commit ${plural(pending.count, "record")}?`,
      body: `This creates ${plural(pending.count, "sale")} and marks ${
        plural(pending.count, "stove")} sold. The sales app's inventory figures will change.`,
      action: `Commit ${NUMBER.format(pending.count)}`,
    }
    : pending
      ? {
        title: `Roll back ${plural(pending.count, "record")}?`,
        body: `This deletes ${plural(pending.count, "sale")} and puts ${
          plural(pending.count, "stove")} back to available.`,
        action: `Roll back ${NUMBER.format(pending.count)}`,
      }
      : null;

  const runPending = () => {
    if (!pending) return;
    const { kind, batchId, count } = pending;
    setPending(null);
    if (kind === "commit") runCommit(batchId, count);
    else runRollback(batchId, count);
  };

  // The history grows for as long as the module runs. A year of daily imports
  // is a list nobody scrolls to the bottom of, and the row somebody wants is
  // usually recent but not always.
  const paged = usePaged(batches, 10);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <AlertDialog open={!!pending} onOpenChange={(next) => { if (!next) setPending(null); }}>
        <AlertDialogContent className="dc-root" data-area="import">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runPending}
              className={
                pending?.kind === "rollback"
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-(--dc-accent) text-white hover:bg-(--dc-accent-strong)"
              }
            >
              {confirmCopy?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <Upload className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Bulk Import</span>
        <span className="text-sm text-gray-500">Digitalized paper receipts</span>
      </div>

      {canUpload && (
        <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setManual(false);
              fileInput.current?.click();
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Choose a file
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPendingFile(null);
              setDuplicate(null);
              setManual((m) => !m);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <PenLine className="h-4 w-4" /> Type one record
          </button>
          <p className="text-xs text-gray-600">
            {/* Said out loud, because the dropdown that used to be here is
                gone and its absence should read as deliberate. */}
            The stove IDs in the file say which partner it belongs to, so there
            is nothing to choose. Staged and checked on upload; nothing is
            committed until you say so.
          </p>
        </div>
      )}

      {canUpload && manual && (
        <ManualEntry
          busy={busy}
          onCancel={() => setManual(false)}
          onSubmit={submitManual}
        />
      )}

      {canUpload && pendingFile && (
        <ColumnMapping
          busy={busy}
          file={pendingFile.file}
          inspection={pendingFile.inspection}
          onCancel={() => setPendingFile(null)}
          onConfirm={(columnMapping) =>
            stageAndValidate(pendingFile.file, { columnMapping })
          }
        />
      )}

      {canUpload && duplicate && (
        <div className="flex flex-wrap items-start gap-2 border-y border-amber-300 bg-amber-50 px-4 py-3">
          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-sm text-amber-900">{duplicate.message}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              stageAndValidate(duplicate.file, {
                ...duplicate.options,
                confirmDuplicate: true,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            Upload it again
          </button>
          <button
            type="button"
            onClick={() => setDuplicate(null)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border-y border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 border-b border-(--dc-primary)/20 bg-(--dc-primary-soft)/50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-(--dc-accent)" />
          <p className="text-sm text-(--dc-accent)">{notice}</p>
        </div>
      )}
      {/*
        The steps outlive `busy`.

        The old progress line was hidden the moment the run ended, so the last
        thing it showed vanished at exactly the moment somebody wanted to read
        it, leaving "Commit finished." as the whole account of a run that may
        have refused half the file.
      */}
      <Steps steps={steps} />
      <Unlanded groups={unlanded} />

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/20 px-4 py-2.5">
        <PeriodFilter
          period={period}
          onChange={setPeriod}
          earliest={earliest}
          area="import"
          noun="imports"
        />
      </div>

      {loading ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading batches...
        </p>
      ) : batches.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-6 text-center text-sm text-gray-500">
          {/*
            "No imports at all" and "none in this period" are different facts,
            and answering the second with the first sends somebody looking for
            a file they did upload.
          */}
          No imports in this period. Widen it above, or choose a file or type
          one record to begin.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-left text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                  <th scope="col" className="px-3 py-2">State</th>
                  <th scope="col" className="px-3 py-2">What was imported</th>
                  <th scope="col" className="px-3 py-2">Partner</th>
                  <th scope="col" className="px-3 py-2 text-right">Rows</th>
                  <th scope="col" className="px-3 py-2 text-right">Committed</th>
                  <th scope="col" className="px-3 py-2">When</th>
                  <th scope="col" className="px-3 py-2">By whom</th>
                  <th scope="col" className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
          {paged.slice.map((b) => (
            <Fragment key={b.id}>
              <tr
                onClick={() => { setOpen(open === b.id ? null : b.id); setDryRun(null); }}
                className="cursor-pointer border-b border-gray-100 transition hover:bg-(--dc-accent-soft)/40"
              >
                <td className="px-3 py-2">
                  <span
                    className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATE_TONE[b.state]}`}
                  >
                    {b.state.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-sm font-medium text-gray-900">
                  {b.filename ?? "(typed in, no file)"}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-2 text-sm text-gray-700">
                  {/*
                    A batch covering several partners is not a batch with a
                    missing partner. "-" said the second thing about the first,
                    which is how somebody concludes the import lost the data.
                  */}
                  {b.partner_name ??
                    (b.partner_count > 1 ? `${b.partner_count} partners` : "-")}
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-700">
                  {b.total_rows}
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-(--dc-accent)">
                  {b.committed_rows}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                  {new Date(b.uploaded_at).toLocaleString()}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-gray-600">
                  {b.uploaded_by_name ?? "-"}
                </td>
                <td className="px-3 py-2 text-right">
                  {open === b.id ? (
                    <ChevronDown className="ml-auto h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                  )}
                </td>
              </tr>

              {open === b.id && (
                <tr className="border-b border-gray-100 bg-(--dc-surface-muted)">
                  <td colSpan={8} className="px-4 py-3">
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Rows" value={b.total_rows} />
                    <Stat label="Ready" value={b.valid_rows} tone="text-(--dc-accent)" />
                    <Stat label="Exceptions" value={b.exception_rows} tone="text-amber-700" />
                    <Stat label="Unreadable" value={Math.max(0, b.rejected_rows - b.exception_rows)} tone="text-red-600" />
                    <Stat label="Committed" value={b.committed_rows} />
                  </div>

                  {b.last_error && (
                    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{b.last_error}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {canUpload && b.state !== "committed" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runDryRun(b.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" /> Dry run
                      </button>
                    )}
                    {canCommit && b.valid_rows > 0 && b.state !== "committed" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPending({ kind: "commit", batchId: b.id, count: b.valid_rows })}
                        className="inline-flex items-center gap-1 rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Commit {b.valid_rows}
                      </button>
                    )}
                    {canCommit && b.committed_rows > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPending({ kind: "rollback", batchId: b.id, count: b.committed_rows })}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Roll back {b.committed_rows}
                      </button>
                    )}
                  </div>

                  {dryRun && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
                      <div className="mb-1 flex items-center gap-2">
                        <Eye className="h-4 w-4 text-amber-700" />
                        <h3 className="text-sm font-semibold text-amber-900">What a commit would do</h3>
                        <button
                          type="button"
                          onClick={() => setDryRun(null)}
                          aria-label="Dismiss the dry run"
                          className="ml-auto rounded p-0.5 text-amber-700 hover:bg-amber-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-sm text-amber-900">{dryRun.note}</p>
                      <p className="mt-2 text-sm text-amber-900">
                        {plural(dryRun.stovesThatWouldSell.length, "stove")} would move from available to sold.
                      </p>
                      {dryRun.stovesThatWouldSell.length > 0 && (
                        <p className="mt-1 break-words font-mono text-xs text-amber-800">
                          {dryRun.stovesThatWouldSell.slice(0, 40).join(", ")}
                          {dryRun.stovesThatWouldSell.length > 40 ? " ..." : ""}
                        </p>
                      )}
                    </div>
                  )}

                  {b.exception_rows > 0 && (
                    <div className="rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                        <Wrench className="h-4 w-4 text-amber-600" />
                        <h3 className="text-sm font-semibold text-gray-900">
                          Exceptions ({b.exception_rows})
                        </h3>
                        <span className="text-xs text-gray-500">
                          Roughly one serial in twelve needs a person. This is the normal path.
                        </span>
                      </div>
                      <ExceptionsQueue
                        batchId={b.id}
                        canResolve={canResolve}
                        onChanged={refresh}
                      />
                      <SharedPhoneRows batchId={b.id} />
                    </div>
                  )}

                  {/* The refused rows, which were counted here and shown
                      nowhere. A batch said "12 unreadable" and the only way to
                      find out which twelve was to open the spreadsheet and
                      guess. */}
                  {b.rejected_rows - b.exception_rows > 0 && (
                    <div className="rounded-lg border border-gray-200 p-3">
                      <RejectedRows
                        batchId={b.id}
                        count={b.rejected_rows - b.exception_rows}
                      />
                    </div>
                  )}
                </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="import"
          />
        </>
      )}
    </div>
  );
}

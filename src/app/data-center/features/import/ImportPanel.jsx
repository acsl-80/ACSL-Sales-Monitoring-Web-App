import { useCallback, useEffect, useRef, useState } from "react";
import { usePeriod } from "../../lib/usePeriod";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { parseCsv, CsvError } from "../../lib/csv";
import { parseWorkbook, canReadWorkbooks, looksLikeWorkbook } from "../../lib/xlsx";
import { plural } from "../../lib/plural";
import { groupUnlanded } from "../../components/Unlanded";
import ConfirmAction from "./ConfirmAction";
import RunReport from "./RunReport";
import UploadStrip from "./UploadStrip";
import FilesTable from "./FilesTable";

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
 *
 * This file owns the state and every call to the server. What it looks like
 * lives beside it - ConfirmAction, RunReport, UploadStrip, FilesTable,
 * FileDetail and ExceptionsTable - each rendering from props and calling back.
 * The split is the 2026-09-07 redesign: the boards changed, the machine did
 * not.
 */

/** What the check found, in the one phrasing both doors use. */
function checkedSaid(counts) {
  return (
    `${counts.valid} ready, ${counts.exception} need a look, ` +
    `${counts.rejected} could not be read` +
    // Rows that WILL land but disagreed with the sheet about something the
    // stove ID overrules. Said, because the alternative is a note computed and
    // thrown away.
    (counts.noted ? `, ${counts.noted} with a note` : "")
  );
}

/**
 * The partners a staged file turned out to hold, said the same way twice: once
 * in the step and once in the notice. Written out once, because the two saying
 * it differently is how a file reads as one partner's in one line and several
 * in the next.
 */
function partnersSaid(resolvedPartner) {
  return (resolvedPartner?.partners ?? [])
    .map((p) => `${[p.partnerName ?? "Unknown", p.branch].filter(Boolean).join(", ")} (${p.count})`)
    .join("; ");
}

/** The sources this panel owns. The call sheet has its own list. */
const RECEIPT_SOURCES = ["receipt", "manual", "field", "workbench"];

export default function ImportPanel({ canUpload, canCommit, canResolve }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  /** What the import is doing now, and what it did. Survives `busy` clearing. */
  const [steps, setSteps] = useState(null);
  const [unlanded, setUnlanded] = useState(null);
  /** Which moment the unlanded list is describing: before a commit, or after. */
  const [unlandedPhase, setUnlandedPhase] = useState("staged");
  const [open, setOpen] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  /** A file held between inspection and staging, while its strays are placed. */
  const [pendingFile, setPendingFile] = useState(null);
  /** A staged upload refused as a repeat. Holds what it takes to send it again. */
  const [duplicate, setDuplicate] = useState(null);
  const [manual, setManual] = useState(false);
  /*
   * The irreversible actions, held until confirmed. window.confirm did this job
   * in the browser's own voice, with no room to say what changes.
   */
  const [pending, setPending] = useState(null);
  const fileInput = useRef(null);

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

  /**
   * The history takes the same period as everything else, on upload date. It
   * is the surface most likely to be asked "what came in last week", and it
   * was the one that could only answer "here are the last fifty".
   */
  const { period, setPeriod, resolved, earliest } = usePeriod("/data-center/import");

  const refresh = useCallback(async () => {
    try {
      const all = await dataCenterImport.batches({
        ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
        ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
      });
      /*
       * Receipt batches only. `batches` answers for every source, and a
       * call-centre batch rendered here looked exactly like a receipt one, down
       * to a next-step button that ran the RECEIPT commit over rows whose
       * `normalized` is not a sale. Older batches predate the column, so a
       * missing source reads as a receipt rather than vanishing from history.
       */
      setBatches(all.filter((b) => !b.source || RECEIPT_SOURCES.includes(b.source)));
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
      // Named in the words of the job, not of the code: "validate" means
      // nothing to somebody holding a stack of receipts.
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
        // No partner is sent. The serial numbers in the file name it, and the
        // server says which one it worked out.
        const staged = await dataCenterImport.stage(null, file.name, file.rows, options);
        const { batchId, resolvedPartner } = staged;
        stepTo(
          "partner",
          "done",
          resolvedPartner?.partners?.length > 1
            ? `${resolvedPartner.partners.length} partners: ${partnersSaid(resolvedPartner)}`
            : (resolvedPartner?.partnerName ?? "one partner"),
        );
        stepTo("check", "running");
        const counts = await dataCenterImport.validate(batchId);
        stepTo("check", "done", checkedSaid(counts));
        // What is wrong, grouped, before anybody presses commit rather than
        // after. The whole point of staging is that this is cheap to look at.
        setUnlandedPhase("staged");
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
            // One partner reads as "for X". Several has to say so, or the
            // operator is told the file is one partner's when it is not.
            (resolvedPartner?.partners?.length > 1
              ? ` across ${resolvedPartner.partners.length} partners: ${partnersSaid(resolvedPartner)}`
              : resolvedPartner?.partnerName
                ? ` for ${resolvedPartner.partnerName}`
                : "") +
            // The three counts belong to the step, not to this line as
            // well. Both said them, one under the other, which is the same
            // numbers twice with nothing saying they are the same numbers.
            `. ${counts.linkedToTransfer} matched to a transfer.` +
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
        // A repeat upload is a warning, not a failure: a partner can legitimately
        // return the same serials after a correction. Hold what it takes to send
        // it again.
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
      // A workbook or a CSV, the same validator behind both, because the
      // sheet this module hands out is a workbook and has to come back as one.
      // What it is, not what it is called: see looksLikeWorkbook.
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

  /*
   * While a batch is being written server-side, keep the list fresh: the chain
   * runs regardless, but a person watching deserves numbers that move. Poll
   * while a chain holds a lease AND while a batch sits part-committed without
   * one - between links the lease clears for a breath, and a page mounting
   * inside that breath would freeze on stale numbers forever.
   */
  useEffect(() => {
    const watchable = (b) =>
      b.committing ||
      (b.state === "validated" && b.valid_rows > 0 && b.committed_rows > 0);
    if (!batches?.some(watchable)) return undefined;
    const t = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [batches, refresh]);

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
   * Check a batch that is sitting unchecked. Checking used to happen only as
   * the second half of an upload, so a batch whose upload staged and then
   * failed could not be checked at all. Same call; it just needed a door.
   */
  const runValidate = async (batchId) => {
    setBusy(true);
    setError(null);
    setUnlanded(null);
    setSteps([
      { key: "check", label: "Checking every row against the stove register", state: "running",
        detail: null },
    ]);
    try {
      const counts = await dataCenterImport.validate(batchId);
      stepTo("check", "done", checkedSaid(counts));
      setUnlandedPhase("staged");
      await collectUnlanded(batchId);
      await refresh();
    } catch (err) {
      stepTo("check", "failed", "Stopped part way. Asking again picks up where it left off.");
      setError(
        err instanceof DataCenterError ? err.message : "The check did not finish. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * One press, then the truth.
   *
   * The old loop lived here - one HTTP call per slice inside one try - so the
   * FIRST slow slice aborted everything with "took too long" while the server
   * kept working, and a 655-row file needed the tab babysat for hours. Now the
   * press kicks the server's own chain and this only WATCHES: poll the live
   * counts, narrate movement, stop when the server says committed. Closing the
   * page changes nothing.
   */
  const runCommit = async (batchId, total) => {
    setBusy(true);
    setUnlanded(null);
    setUnlandedPhase("committed");
    setSteps([
      { key: "write", label: "Writing the sales", state: "running",
        detail: "Starting on the server..." },
      { key: "settled", label: "Finished", state: "pending", detail: null },
    ]);
    let done = 0;
    try {
      const kick = await dataCenterImport.commit(batchId);
      if (kick.done && !kick.started) {
        // Nothing left to write - the batch was already drained.
        done = 0;
      } else if (kick.stopped) {
        throw new DataCenterError(
          "The run hit its safety cap. Press Commit to continue.", 200, "chain_cap",
        );
      } else {
        // started, or busy: either way a chain is working the batch. Watch it.
        stepTo(
          "write", "running",
          kick.busy
            ? "Already running on the server. Watching it."
            : "Running on the server. You can leave this page - it keeps going.",
        );
        let lastMoved = Date.now();
        let lastCount = -1;
        for (;;) {
          await new Promise((r) => setTimeout(r, 5000));
          const rows = await dataCenterImport.batches({ batchId });
          const b = rows.find((x) => x.id === batchId);
          if (!b) throw new DataCenterError("The batch disappeared.", 404, "gone");
          done = b.committed_rows;
          stepTo(
            "write", "running",
            `${b.committed_rows} of ${total} written, ${b.valid_rows} to go - ` +
              "running on the server. You can leave this page.",
          );
          if (b.committed_rows !== lastCount) {
            lastCount = b.committed_rows;
            lastMoved = Date.now();
          }
          if (b.state === "committed" || b.valid_rows === 0) break;
          /*
           * A stall is a quiet ninety seconds with no lease held. A lease with
           * no movement is a slow link; no lease and no movement is a chain
           * that died - a logout mid-run does this, since every link
           * re-validates the session.
           */
          if (!b.committing && Date.now() - lastMoved > 90_000) {
            throw new DataCenterError(
              b.last_error ??
                "The run stopped - a sign-out mid-run does this. Press Commit to continue from where it reached.",
              408,
              "stalled",
            );
          }
        }
      }
      stepTo("write", "done", `${plural(done, "sale")} written`);

      /*
       * What did not land, said out loud. This used to read "Commit finished."
       * over any number of rows that did not, while the server had been
       * returning a reason for each one all along.
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
      stepTo("write", "failed", "Paused. Pressing Commit continues from where it reached.");
      await collectUnlanded(batchId);
      setError(err instanceof DataCenterError ? err.message : "Commit paused. Press Commit to continue.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Clear away a batch that never became sales: a staged file nobody committed,
   * a bench batch a typist abandoned. Rollback exists to undo sales and these
   * have none, so without this they accumulated with no exit at all.
   */
  const runDiscard = async (batchId) => {
    setBusy(true);
    setError(null);
    try {
      const out = await dataCenterImport.discard(batchId);
      setNotice(
        out.drafts > 0
          ? `Discarded. ${plural(out.drafts, "part-typed record")} went with it.`
          : "Discarded.",
      );
      setSteps([]);
      setUnlanded(null);
      await refresh();
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "That batch could not be discarded.",
      );
    } finally {
      setBusy(false);
    }
  };

  const runRollback = async (batchId, committed) => {
    setBusy(true);
    let reversed = 0;
    try {
      /*
       * Still client-driven - rollbacks are small and rare - but each slice is
       * its own try, so one slow slice pauses the run instead of dressing a
       * resumable state as a failure.
       */
      let refused = null;
      let remaining = committed;
      for (;;) {
        let out;
        try {
          out = await dataCenterImport.rollback(batchId);
        } catch (err) {
          if (err instanceof DataCenterError && err.code === "timeout") {
            // The server is still reversing; ask again rather than abandon.
            continue;
          }
          throw err;
        }
        reversed += out.reversed;
        remaining = out.remaining;
        if (out.done) break;
        /*
         * Nothing moved and the server says it is not done: delete-sale refused
         * every sale still standing, and the reason is in the body. This used
         * to fall through to the success notice, so an operator without delete
         * rights was told "Rolled back. 0 sales reversed." over a batch that
         * had not changed.
         */
        if (out.reversed === 0) {
          refused = out.failures?.[0]?.reason ?? "delete-sale refused every remaining sale";
          break;
        }
      }
      if (refused !== null) {
        setError(
          `Rollback stopped. ${plural(remaining, "sale")} could not be removed: ${refused}` +
            (reversed > 0 ? ` ${plural(reversed, "sale")} had been reversed before it stopped.` : ""),
        );
      } else {
        setNotice(`Rolled back. ${plural(reversed, "sale")} reversed.`);
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof DataCenterError
          ? err.message
          : `Rollback paused after ${plural(reversed, "sale")}. Press it again to continue.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const runPending = () => {
    if (!pending) return;
    const { kind, batchId, count } = pending;
    setPending(null);
    if (kind === "commit") runCommit(batchId, count);
    else if (kind === "discard") runDiscard(batchId);
    else runRollback(batchId, count);
  };

  /** Open or close a batch. Closing takes its dry run with it. */
  const toggleOpen = (batchId) => {
    setOpen(open === batchId ? null : batchId);
    setDryRun(null);
  };

  /**
   * Hold one of the three confirmed actions until it is confirmed, with the
   * count each of them is about: what would be written, what would be thrown
   * away, what would be reversed.
   */
  const ask = (kind, b) =>
    setPending({
      kind,
      batchId: b.id,
      count: kind === "commit"
        ? b.valid_rows
        : kind === "rollback"
          ? b.committed_rows
          // Discard throws away part-typed drafts, and nothing else.
          : Math.max(
            0,
            (b.total_rows ?? 0) - (b.valid_rows ?? 0) -
              (b.rejected_rows ?? 0) - (b.exception_rows ?? 0),
          ),
    });

  return (
    <div className="space-y-4">
      <ConfirmAction
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={runPending}
      />

      {canUpload && (
        <UploadStrip
          busy={busy}
          fileInputRef={fileInput}
          onFile={onFile}
          onChooseFile={() => {
            setManual(false);
            fileInput.current?.click();
          }}
          onTypeOneRecord={() => {
            setPendingFile(null);
            setDuplicate(null);
            setManual((m) => !m);
          }}
          manual={manual}
          onManualCancel={() => setManual(false)}
          onManualSubmit={submitManual}
          pendingFile={pendingFile}
          onMappingCancel={() => setPendingFile(null)}
          onMappingConfirm={(columnMapping) =>
            stageAndValidate(pendingFile.file, { columnMapping })
          }
          duplicate={duplicate}
          onUploadAgain={() =>
            stageAndValidate(duplicate.file, {
              ...duplicate.options,
              confirmDuplicate: true,
            })
          }
          onDuplicateDismiss={() => setDuplicate(null)}
        />
      )}

      <RunReport
        error={error}
        notice={notice}
        steps={steps}
        unlanded={unlanded}
        phase={unlandedPhase}
      />

      <FilesTable
        batches={batches}
        loading={loading}
        busy={busy}
        canUpload={canUpload}
        canCommit={canCommit}
        open={open}
        onToggle={toggleOpen}
        onValidate={runValidate}
        onAsk={ask}
        period={period}
        onPeriod={setPeriod}
        earliest={earliest}
        detail={{
          canResolve,
          dryRun,
          onDryRun: runDryRun,
          onDryRunDismiss: () => setDryRun(null),
          onChanged: refresh,
        }}
      />
    </div>
  );
}

import { useState, useRef } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { canReadWorkbooks, looksLikeWorkbook, parseWorkbook } from "../../lib/xlsx";
import { parseCsv } from "../../lib/csv";
import { plural } from "../../lib/plural";
import Unlanded, { groupUnlanded } from "../../components/Unlanded";
import CallBatches from "./CallBatches";
import GetTheCallSheet from "./GetTheCallSheet";
import NumberedStep from "../../components/NumberedStep";
import Steps, { advance } from "../../components/Steps";
import { PhoneCall, ArrowRight, Loader2, CircleAlert, CircleCheck, Undo2 } from "lucide-react";

/**
 * The call centre's own backlog, in and out.
 *
 * Agents have kept their own spreadsheets since before this module existed.
 * One week of the workbook holds 359 stove IDs, and until now the only way in
 * was the call form, one record at a time - which is not a backlog strategy,
 * it is a reason the backlog stays where it is.
 *
 * WHY THIS SHEET GOES THE OTHER WAY FROM THE DIGITALISATION ONE
 *
 * That sheet creates sales. This one MATCHES them. A phone call cannot bring a
 * stove into existence, so a row whose stove ID finds no sale is an exception
 * for somebody to look at rather than a new record - and the usual cause is
 * simply that the receipt has not been digitalised yet, which is why the two
 * imports have an order and this one is second.
 *
 * WHY THE SHEET IS PREFILLED
 *
 * The same reason the digitalisation sheet is: a hand-typed stove ID is the
 * one error the import cannot recover from. A mistyped serial does not look
 * like a typo, it looks like a stove that is not ours. So the stove IDs, the
 * buyer and the number on record come down already filled and locked, and the
 * agent types only what the call told them.
 */

export default function CallSheet({ canCommit = false, canResolve = false }) {
  /*
   * Bumped whenever this component lands something, so the list below reloads.
   * A batch staged here has to appear there immediately: the whole point of
   * the list is that work does not vanish when the tab closes, and a list that
   * only refreshes on mount would prove the opposite on the very first upload.
   */
  const [reloadKey, setReloadKey] = useState(0);
  /*
   * Named stages rather than one spinner.
   *
   * An upload does three distinct things and any of them can be the one that
   * failed. "reading and checking every row" told somebody a spinner was
   * spinning; it did not tell them whether the file parsed, whether the
   * partner resolved, or which stove IDs found no sale.
   */
  const [steps, setSteps] = useState(null);
  const [spec, setSpec] = useState(null);
  const [schema, setSchema] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [partners, setPartners] = useState(null);
  /** True when the partner list could not be fetched, as opposed to being empty. */
  const [partnersFailed, setPartnersFailed] = useState(false);
  /** "" is everything this person may see. Otherwise an organization id. */
  const [orgId, setOrgId] = useState("");
  /** Narrow to records nobody has called. Off by default under update mode. */
  const [uncalledOnly, setUncalledOnly] = useState(false);
  const [downloaded, setDownloaded] = useState(null); // { rows, partner }
  const [batch, setBatch] = useState(null); // { batchId, staged }
  const [checked, setChecked] = useState(null); // validate summary
  const [result, setResult] = useState(null); // commit summary
  const [progress, setProgress] = useState(null); // { done, total } while a chain runs
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy("upload");
    setError("");
    setBatch(null);
    setChecked(null);
    setResult(null);
    try {
      // Both parsers answer { headers, rows, warnings }. Taking the wrapper
      // for the rows would stage one object and call it a spreadsheet.
      setSteps([
        { key: "read", label: `Reading ${file.name}`, state: "running" },
        { key: "stage", label: "Putting the rows aside", state: "pending" },
        { key: "check", label: "Matching every row to a sale", state: "pending" },
        { key: "ready", label: "Ready", state: "pending" },
      ]);
      const step = (k, s, d) => setSteps((cur) => advance(cur ?? [], k, s, d));

      /*
       * Say which browser cannot do it, rather than which file cannot be read.
       *
       * Reading an .xlsx needs DecompressionStream. Without it, parseWorkbook
       * throws and the catch below reported "That file could not be read",
       * which points at the sheet - the one thing that is not the problem, and
       * the thing somebody would then waste an afternoon re-exporting.
       */
      const isWorkbook = await looksLikeWorkbook(file);
      if (isWorkbook && !canReadWorkbooks()) {
        step("read", "failed", "This browser cannot open .xlsx.");
        setError(
          "This browser cannot open .xlsx files. Download the sheet as CSV instead, " +
            "or open it in a spreadsheet program and save a CSV - the columns are the same.",
        );
        return;
      }

      const parsed = isWorkbook ? await parseWorkbook(file) : parseCsv(await file.text());
      const rows = parsed.rows ?? [];

      if (!rows.length) {
        step("read", "failed", "There are no rows in it.");
        setError("That file has no rows in it.");
        return;
      }
      /*
       * The parser's warnings, said out loud.
       *
       * They were read and thrown away. That is where duplicate headers,
       * blank columns and ragged rows are reported - and a duplicate header
       * is the defect that once destroyed 971 of 983 phone numbers before
       * the importer ever saw them. The fix for that has been running in the
       * parser the whole time; only its warning was muted.
       */
      step(
        "read",
        "done",
        `${plural(rows.length, "row")} read${
          parsed.warnings?.length ? `. ${parsed.warnings.join(" ")}` : ""
        }`,
      );
      if (parsed.warnings?.length) setError(parsed.warnings.join(" "));

      step("stage", "running");
      const staged = await dataCenterImport.callStage(rows, file.name);
      setBatch(staged);
      step("stage", "done");

      step("check", "running");
      const summary = await dataCenterImport.callValidate(staged.batchId);
      setChecked(summary);
      step(
        "check",
        "done",
        `${summary.valid} ready, ${summary.exceptions} need a person, ` +
          `${summary.rejected} could not be read.`,
      );
      step("ready", "done");
      setReloadKey((n) => n + 1);
    } catch (e) {
      /*
       * Mark whichever stage was running as failed, rather than leaving it
       * spinning above an error banner. The useful question after a failure
       * is which stage it got to, and a stage frozen on "running" answers
       * the opposite of the truth.
       */
      setSteps((cur) => {
        const at = (cur ?? []).find((s) => s.state === "running");
        return at ? advance(cur, at.key, "failed") : cur;
      });
      setError(e instanceof DataCenterError ? e.message : "That file could not be read");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /**
   * One press, then watch.
   *
   * This was a client-side loop of up to 200 blocking requests wrapped in ONE
   * try, so the first slice to hit the twenty-second abort killed the whole
   * run and reported whatever it had. Each row is a save plus up to three
   * attempt writes, every one its own edge-function invocation, so a 25-row
   * slice was comfortably past that abort. A real weekly sheet could not
   * finish, and this had only ever been proved on six rows.
   *
   * Now the server holds a lease and works through the batch on its own. The
   * client presses once and reads the batch's own counts back.
   */
  const commit = async () => {
    if (!batch) return;
    setBusy("commit");
    setError("");
    setProgress({ done: 0, total: checked?.valid ?? 0 });
    try {
      const kick = await dataCenterImport.callCommit(batch.batchId);
      if (kick.stopped) {
        throw new DataCenterError(
          "The run hit its safety cap. Press Attach again to carry on.",
          200,
          "chain_cap",
        );
      }

      let done = kick.committed ?? 0;
      // `done` with nothing started means there was nothing left to do.
      // Anything else - started, or busy because another link holds it -
      // means a chain is working the batch and this watches it.
      if (!(kick.done && !kick.started)) {
        let lastMoved = Date.now();
        let lastCount = -1;
        for (;;) {
          await new Promise((r) => setTimeout(r, 5000));
          const rows = await dataCenterImport.batches({ batchId: batch.batchId });
          const b = rows.find((x) => x.id === batch.batchId);
          if (!b) throw new DataCenterError("The batch is no longer there.", 404, "gone");

          done = b.committed_rows;
          setProgress({ done, total: checked?.valid ?? 0 });
          if (b.committed_rows !== lastCount) {
            lastCount = b.committed_rows;
            lastMoved = Date.now();
          }
          if (b.state === "committed" || b.valid_rows === 0) break;

          /*
           * A lease with no movement is a slow link, not a stall. No lease
           * AND no movement is a chain that died - a sign-out mid-run does
           * exactly that, because every link re-checks the session.
           */
          if (!b.committing && Date.now() - lastMoved > 90_000) {
            throw new DataCenterError(
              b.last_error ??
                "It stopped before finishing. Signing out mid-run does this. " +
                  "Press Attach again and it picks up where it left off.",
              408,
              "stalled",
            );
          }
        }
      }

      const groups = await groupUnlanded(batch.batchId);
      setResult({ committed: done, groups });
      setReloadKey((n) => n + 1);
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "The commit did not finish");
    } finally {
      setBusy("");
      setProgress(null);
    }
  };

  const undo = async () => {
    if (!batch) return;
    setBusy("undo");
    setError("");
    try {
      const out = await dataCenterImport.callRollback(batch.batchId);
      setResult(null);
      setChecked((c) => (c ? { ...c, valid: out.reversed } : c));
      /*
       * Rows that UPDATED a record cannot be undone by deleting it: the record
       * was not this batch's to remove. Said out loud, because "reversed 40"
       * on a 60-row batch otherwise reads as all of it.
       */
      if (out.notReversed > 0) {
        setError(
          `${plural(out.reversed, "call record")} removed. ` +
            `${plural(out.notReversed, "row")} updated a record that already existed, ` +
            "and those cannot be undone this way - the record was not this sheet's to remove.",
        );
      }
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "The rollback did not finish");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--dc-accent) text-white">
            <PhoneCall className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900">Calls already made</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              For work an agent has already done on their own spreadsheet. It attaches calls to
              records that exist; it never creates a sale, so a stove whose receipt has not been
              digitalised yet comes back as something to fix rather than going in wrong.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <ol className="mt-4 space-y-2">
          {/*
          Step one lives in its own component now. Handing somebody a file and
          taking one back share no state, and together they had grown this file
          to 904 lines against the module's own 600-line rule.
        */}
          <GetTheCallSheet active={!batch} />

          <NumberedStep n={2} title="Fill it in, away from the app">
            Excel keeps the dropdowns, so an outcome typed as &quot;Unreacheable&quot; is caught
            before the upload rather than after it. Leave a row blank and nothing happens to that
            record.
          </NumberedStep>

          <NumberedStep n={3} title="Bring it back" tone={batch ? "active" : "plain"}>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              aria-label="Call-centre sheet"
              onChange={(e) => upload(e.target.files?.[0])}
              disabled={busy !== ""}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-(--dc-accent-soft) file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-(--dc-accent-strong)"
            />
            {steps && (
              <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                <Steps steps={steps} />
              </div>
            )}
          </NumberedStep>
        </ol>

        {checked && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-(--dc-surface-muted) p-4">
            <p className="text-sm font-semibold text-gray-900">
              {plural(checked.total, "row")} checked
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Ready", checked.valid, "text-emerald-700"],
                ["Need a person", checked.exceptions, "text-amber-700"],
                ["Unreadable", checked.rejected, "text-red-700"],
              ].map(([label, n, tone]) => (
                <div key={label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className={`text-lg font-bold ${tone}`}>{n}</dd>
                </div>
              ))}
            </dl>

            {/*
            What "Ready" is about to do, split.
            Attaching a new record and rewriting one somebody already worked
            are different acts, and a single "Ready: 52" hides which this is.
          */}
            {checked.valid > 0 && (checked.updating ?? 0) > 0 && (
              <p className="mt-2 text-xs text-gray-700">
                Of those, {plural(checked.creating ?? 0, "row")} attaches a new record and{" "}
                <strong>{plural(checked.updating, "row")} updates one that already exists</strong>.
                A row whose record changed in the app after you downloaded the sheet is not in this
                count; it is waiting for a person instead.
              </p>
            )}

            {checked.exceptions > 0 && (
              <p className="mt-2 text-xs text-gray-600">
                Rows needing a person are usually stoves whose receipt has not been digitalised yet.
                They stay in this batch with the reason on each one; nothing about them is lost.
              </p>
            )}

            {!result && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={commit}
                  disabled={!canCommit || busy !== "" || checked.valid === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
                >
                  {busy === "commit" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  Attach {plural(checked.valid, "call")}
                </button>
                {!canCommit && (
                  <span className="text-xs text-gray-500">
                    Somebody with the commit grant releases these.
                  </span>
                )}
                {progress && (
                  <span className="text-xs text-gray-600">
                    {progress.done} of {progress.total} attached. This continues on the server, so
                    you can leave this page.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {result && (
          /*
          Green only when it all went in.

          This box was emerald whatever happened, with one line saying some rows
          "kept its reason" - which tells somebody a reason exists without
          showing it, in the colour used for success. A run that refused half
          the file should not look like a run that did not.
        */
          <div
            className={`mt-3 rounded-xl border p-4 ${
              result.groups?.length > 0
                ? "border-amber-200 bg-amber-50"
                : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <p
              className={`flex items-center gap-2 text-sm font-semibold ${
                result.groups?.length > 0 ? "text-amber-900" : "text-emerald-900"
              }`}
            >
              <CircleCheck className="h-4 w-4" /> {plural(result.committed, "call record")} attached
            </p>
            {result.groups?.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-lg border border-amber-200 bg-white">
                <Unlanded groups={result.groups} />
              </div>
            )}

            {canCommit && (
              <button
                type="button"
                onClick={undo}
                disabled={busy !== ""}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                {busy === "undo" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                Undo this import
              </button>
            )}
            {/*
            Undo here removes the call records and nothing else. It is not the
            receipt import's rollback, which deletes the sale itself - doing
            that here would delete somebody's sale because an outcome was
            mis-typed.
          */}
            <p className="mt-2 text-xs text-emerald-800">
              Undo removes these call records only. The sales stay exactly as they were.
            </p>
          </div>
        )}
      </section>

      {/*
      Every sheet ever uploaded, and what each still needs.

      This is what stops work vanishing. Before it, the batch lived in this
      component's own state and nowhere else: close the tab after uploading and
      the rows were still in the database with no screen that would show them.
    */}
      <CallBatches
        canCommit={canCommit}
        canResolve={canResolve}
        reloadKey={reloadKey}
        onChanged={() => setReloadKey((n) => n + 1)}
      />
    </>
  );
}

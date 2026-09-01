import { useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  dataCenterClient,
  dataCenterImport,
  dataCenterWrite,
  DataCenterError,
} from "../../lib/client";
import { buildWorkbook, downloadWorkbook, parseWorkbook, looksLikeWorkbook } from "../../lib/xlsx";
import { parseCsv } from "../../lib/csv";
import { toCsv, downloadCsv } from "../../lib/export";
import { plural } from "../../lib/plural";
import Unlanded, { groupUnlanded } from "../../components/Unlanded";
import CallBatches from "./CallBatches";
import Steps, { advance } from "../../components/Steps";
import {
  Download, PhoneCall, ArrowRight, Loader2, CircleAlert, CircleCheck, Undo2,
} from "lucide-react";

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

const LOCKED_FROM_QUEUE = {
  stoveSerialNo: (r) => r.stove_serial_no ?? "",
  endUserName: (r) => r.end_user_name ?? "",
  phone: (r) => r.primary_phone ?? r.phone ?? "",
  partnerName: (r) => r.partner_name ?? "",
  salesDate: (r) => r.sales_date ?? "",
  /*
   * The version this sheet was built from.
   *
   * Blank for a record nobody has called, because there is nothing to
   * disagree with yet. On a record that HAS been called it is what stops a
   * sheet filled in over three days from silently overwriting whatever an
   * agent did in the app on day two - the import compares it and refuses
   * rather than guessing.
   */
  recordVersion: (r) => (r.call_record_version ?? "") === "" ? "" : String(r.call_record_version),
};

/**
 * What the sheet already knows about a record somebody has worked.
 *
 * Update mode is only usable if a person can see what the record currently
 * says before they change it. Every one of these is already in the Table 2
 * projection the queue returns, so filling them in costs nothing extra.
 *
 * Not locked: the whole point is that these are editable. The version column
 * above is what makes editing them safe.
 */
const PREFILL_FROM_QUEUE = {
  verification: (r) => r.verification_outcome ?? "",
  callOutcome: (r) => r.call_outcome ?? "",
  callAgent: (r) => r.call_agent ?? "",
  callDate1: (r) => r.call_date_1 ?? "",
  callDate2: (r) => r.call_date_2 ?? "",
  callDate3: (r) => r.call_date_3 ?? "",
  correctedName: (r) => r.corrected_end_user_name ?? "",
  correctedPhone: (r) => r.corrected_phone ?? "",
  correctedAltPhone: (r) => r.corrected_alt_phone ?? "",
  correctedAddress: (r) => r.corrected_address ?? "",
  correctedState: (r) => r.corrected_state ?? "",
  correctedLga: (r) => r.corrected_lga ?? "",
  ward: (r) => r.ward ?? "",
  landmark: (r) => r.landmark ?? "",
  statedSerial: (r) => r.stated_serial ?? "",
  comments: (r) => r.other_comments ?? "",
};

function Step({ n, title, tone = "plain", children }) {
  return (
    <li
      className={`relative flex gap-3 rounded-xl border p-4 ${
        tone === "active"
          ? "border-(--dc-accent)/40 bg-(--dc-accent-soft)/40"
          : "border-gray-200 bg-white"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          tone === "active" ? "bg-(--dc-accent) text-white" : "bg-gray-100 text-gray-600"
        }`}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <div className="mt-1 text-sm text-gray-600">{children}</div>
      </div>
    </li>
  );
}

export default function CallSheet({ canCommit = false }) {
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

  useEffect(() => {
    let live = true;
    Promise.all([
      dataCenterImport.callSheet(),
      dataCenterWrite.formSchema(),
      /*
       * The partner list is a facet, so it is already scoped to what this
       * person may see. A picker offering partners whose records they cannot
       * download would be a list of disappointments.
       */
      dataCenterClient.recordFacets().catch(() => "failed"),
    ])
      .then(([s, f, facets]) => {
        if (!live) return;
        setSpec(s);
        setSchema(f);
        /*
         * A failure here is reported, not swallowed.
         *
         * The first version caught it and set an empty list, which renders as a
         * picker offering "everything" and nothing else. That is exactly what a
         * database with one partner looks like, so a broken facets call would
         * have been indistinguishable from a working one, and somebody would
         * have downloaded the whole queue believing they had asked for a
         * partner. Failing visibly costs one line and removes a whole class of
         * quiet wrong answer.
         */
        if (facets === "failed") {
          setPartnersFailed(true);
          setPartners([]);
        } else {
          setPartners(facets?.partners ?? []);
        }
      })
      .catch((e) => live && setError(e instanceof DataCenterError ? e.message : "Could not load the sheet"));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Every column, in the order a person reads them: what we already know,
   * then what the call told them, then the questions the registry asks.
   *
   * The questions come from `field_defs` through the server rather than being
   * listed here, so retiring one in Settings takes it off the sheet with no
   * release. That is the same promise the call form makes, and a sheet that
   * kept asking a retired question would quietly reintroduce it.
   */
  const columns = useMemo(() => {
    if (!spec) return [];
    const options = schema?.options ?? {};
    const fromSpec = spec.columns.map((c) => ({
      ...c,
      options: c.choices
        ? c.choices.map((x) => x.label)
        : c.optionList
          ? (options[c.optionList] ?? []).map((o) => o.label)
          : undefined,
    }));
    const fromRegistry = (spec.questions ?? []).map((q) => ({
      field: q.key,
      header: q.label,
      help: "From the call form.",
      options:
        q.input_type === "select" && q.option_list_key
          ? (options[q.option_list_key] ?? []).map((o) => o.label)
          : undefined,
    }));
    return [...fromSpec, ...fromRegistry];
  }, [spec, schema]);

  const download = async (asXlsx) => {
    setBusy("download");
    setError("");
    try {
      /*
       * The queue, not every sale.
       *
       * `call_queue` is already scoped to what this person may see and already
       * excludes records somebody else is holding, so the sheet cannot hand
       * one agent another's work. It is also the same list the call centre
       * page shows, which means the sheet and the screen never disagree about
       * what is outstanding.
       *
       * `hasCallRecord: false` is the order of work stated as a filter. A
       * record that already has an outcome comes back from the import refused
       * rather than merged, so offering it here would hand somebody rows that
       * cannot land and let them find out after they had filled them in.
       */
      /*
       * Every record, or only the ones nobody has called.
       *
       * This used to be `hasCallRecord: false` with no way round it, which
       * made the sheet single-use: a mis-typed outcome could only ever be
       * corrected one record at a time in the app. Update mode changed that,
       * so the default is now everything, and the narrowing is a choice.
       *
       * The partner filter matters more than it did, for the same reason: at
       * 500,000 records "everything" is not a sheet anybody can open.
       */
      const filters = {
        ...(uncalledOnly ? { hasCallRecord: false } : {}),
        ...(orgId ? { organizationId: orgId } : {}),
      };

      /*
       * Paged to the end, not capped.
       *
       * This asked for 500 and took whatever came back. A partner with more
       * than that got a sheet that looked complete and was not, and nothing on
       * it said so - which for a backlog import is the worst kind of wrong,
       * because the rows that were silently missing are exactly the ones
       * nobody then chases.
       *
       * PAGE_LIMIT bounds one request, not the download. The loop bound is a
       * runaway guard rather than a business rule; it is far above any real
       * partner and it says so out loud if it is ever reached.
       */
      /*
       * 200, because that is what the server actually grants.
       *
       * This asked for 500 and the comment claimed a 200,000-record ceiling.
       * `records-query.ts` clamps every request to MAX_PAGE_SIZE = 200, so the
       * real ceiling was 80,000 and each page cost 2.5x the round trips it
       * meant to. Asking for what is granted makes the arithmetic below true.
       */
      const PAGE_LIMIT = 200;
      const MAX_PAGES = 400; // 80,000 records
      const collected = [];
      let cursor = null;
      let pages = 0;
      let truncated = false;
      for (;;) {
        const page = await dataCenterClient.getCallQueue({
          limit: PAGE_LIMIT,
          cursor,
          filters,
        });
        collected.push(...(page.rows ?? []));
        pages += 1;
        if (!page.hasMore || !page.nextCursor) break;
        if (pages >= MAX_PAGES) {
          truncated = true;
          break;
        }
        cursor = page.nextCursor;
      }

      const rows = collected.map((r) => {
        const out = {};
        const answers = r.answers ?? {};
        for (const c of columns) {
          const locked = LOCKED_FROM_QUEUE[c.field];
          const prefill = PREFILL_FROM_QUEUE[c.field];
          if (locked) out[c.header] = locked(r);
          else if (prefill) out[c.header] = prefill(r);
          // The 13 registry questions, whose answers live in one jsonb blob
          // rather than in columns of their own.
          else if (answers[c.field] !== undefined && answers[c.field] !== null) {
            out[c.header] = String(answers[c.field]);
          } else out[c.header] = "";
        }
        return out;
      });

      if (rows.length === 0) {
        setError(
          orgId
            ? "There are no records for that partner, so the sheet would be empty."
            : "There are no records to bring down, so the sheet would be empty.",
        );
        return;
      }

      const chosen = (partners ?? []).find((x) => x.id === orgId);
      const stem = `call-centre-sheet-${
        chosen ? `${chosen.name ?? "partner"}-`.replace(/[^A-Za-z0-9-]+/g, "-") : ""
      }${new Date().toISOString().slice(0, 10)}`;
      if (asXlsx) {
        downloadWorkbook(
          `${stem}.xlsx`,
          buildWorkbook(
            columns.map((c) => ({
              header: c.header,
              options: c.options,
              help: c.help ?? (c.locked ? "Filled in already. Do not change it." : ""),
              width: c.locked ? 18 : 24,
            })),
            rows,
            { sheetName: "Call centre" },
          ),
        );
      } else {
        downloadCsv(`${stem}.csv`, toCsv(rows, columns.map((c) => c.header)));
      }

      setDownloaded({ rows: rows.length, partner: chosen ?? null });
      // Said rather than left to be discovered. Reaching this means something
      // is wrong with the assumption behind MAX_PAGES, not with the sheet.
      if (truncated) {
        setError(
          `The sheet stopped at ${rows.length.toLocaleString()} records, which is this ` +
            "download's ceiling. Pick a single partner to bring the rest in.",
        );
      }
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "Could not build the sheet");
    } finally {
      setBusy("");
    }
  };

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

      const parsed = (await looksLikeWorkbook(file))
        ? await parseWorkbook(file)
        : parseCsv(await file.text());
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
      step("read", "done", `${plural(rows.length, "row")} read${
        parsed.warnings?.length ? `. ${parsed.warnings.join(" ")}` : ""
      }`);
      if (parsed.warnings?.length) setError(parsed.warnings.join(" "));

      step("stage", "running");
      const staged = await dataCenterImport.callStage(rows, file.name);
      setBatch(staged);
      step("stage", "done");

      step("check", "running");
      const summary = await dataCenterImport.callValidate(staged.batchId);
      setChecked(summary);
      step("check", "done",
        `${summary.valid} ready, ${summary.exceptions} need a person, ` +
        `${summary.rejected} could not be read.`);
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
        <Step n={1} title="Get the sheet" tone={!batch ? "active" : "plain"}>
          <p>
            One row per record, with the stove ID, the buyer and the number we hold already
            filled in and locked. A record somebody has already worked comes down with what it
            currently says, so the sheet can correct it as well as fill it in. Its Record
            Version comes with it, and an upload is refused if the record changed in the app
            after you downloaded, rather than quietly overwriting that work.
          </p>

          {/*
            Which partner, or all of them.

            The label carries the branch and the state as well as the name,
            because the name on its own does not identify a partner: several
            names cover more than one organization, and two Solar Sister rows
            are both called "Main Branch". Somebody picking from names alone
            cannot tell which one they chose, and would find out from the
            contents of the sheet.
          */}
          {/*
            htmlFor and an id, not a wrapper.

            A <label> around a <select> does associate them, but the accessible
            name becomes the label's whole text content, and the selected
            <option> is inside it. The module learned this once already, on a
            field labelled "Partner" that answered to "PartnerAny partner".
          */}
          <div className="mt-2 block">
            <label
              htmlFor="dc-callsheet-partner"
              className="block text-xs font-medium text-gray-700"
            >
              Whose records
            </label>
            <div className="mt-1 max-w-md">
              <SearchableSelect
                id="dc-callsheet-partner"
                ariaLabel="Whose records"
                value={orgId}
                onChange={(next) => {
                  setOrgId(next);
                  setDownloaded(null);
                  setError("");
                }}
                disabled={busy === "download" || partners === null}
                placeholder={
                  partners === null ? "Loading partners..." : "Everything waiting to be called"
                }
                searchPlaceholder="Type part of the partner's name"
                emptyLabel="No partner you cover matches that"
                pinned={{ value: "", label: "Everything waiting to be called" }}
                options={(partners ?? []).map((x) => ({
                  value: x.id,
                  /*
                    Branch and state are part of the label, not decoration.
                    Several partners share a name - Solar Sister has two rows
                    both called "Main Branch", in different states - so a name
                    alone cannot be picked between.
                  */
                  label: [x.name ?? "Unnamed partner", x.branch, x.state]
                    .filter(Boolean)
                    .join(", "),
                }))}
              />
            </div>
          </div>

          <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={uncalledOnly}
              onChange={(ev) => {
                setUncalledOnly(ev.target.checked);
                setDownloaded(null);
                setError("");
              }}
              disabled={busy === "download"}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>
              Only records nobody has called yet
              <span className="block text-xs text-gray-500">
                Leave this off to bring down everything, which is what makes correcting a
                record possible. Turn it on for a plain backlog run.
              </span>
            </span>
          </label>

          {partnersFailed && (
            <p className="mt-1 flex items-start gap-2 text-sm text-amber-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              The partner list could not be loaded, so only the whole queue can be downloaded.
              Reload the page to try again.
            </p>
          )}

          {/*
            No partners is a real answer and it needs saying.

            The list is scoped to the partners this person covers, so somebody
            with no assignments gets an empty one. On screen that is identical
            to a list that loaded fine and to one that failed: a control with a
            single option and nothing explaining why. Saying it costs a line and
            turns "this feature looks broken" into "ask for an assignment".
          */}
          {!partnersFailed && partners !== null && partners.length === 0 && (
            <p className="mt-1 text-sm text-gray-600">
              No partners are assigned to you, so there is nobody to narrow to. The whole queue
              is what you can see.
            </p>
          )}

          {downloaded && (
            <p className="mt-2 flex items-start gap-2 text-sm text-gray-700">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-(--dc-primary)" />
              {plural(downloaded.rows, "record")} in the sheet
              {downloaded.partner
                ? ` for ${[downloaded.partner.name, downloaded.partner.branch]
                    .filter(Boolean)
                    .join(", ")}`
                : ", across every partner you can see"}
              .
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => download(true)}
              disabled={busy !== "" || columns.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              {busy === "download" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download as Excel
            </button>
            <button
              type="button"
              onClick={() => download(false)}
              disabled={busy !== "" || columns.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent) px-3 py-1.5 text-sm font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> CSV instead
            </button>
          </div>
          {columns.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {plural(columns.length, "column")}, including {plural(spec?.questions?.length ?? 0, "question")} from
              the call form. Change them in Settings, not here.
            </p>
          )}
        </Step>

        <Step n={2} title="Fill it in, away from the app">
          Excel keeps the dropdowns, so an outcome typed as &quot;Unreacheable&quot; is caught
          before the upload rather than after it. Leave a row blank and nothing happens to that
          record.
        </Step>

        <Step n={3} title="Bring it back" tone={batch ? "active" : "plain"}>
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
        </Step>
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
              A row whose record changed in the app after you downloaded the sheet is not in
              this count; it is waiting for a person instead.
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
                  {progress.done} of {progress.total} attached. This continues on the
                  server, so you can leave this page.
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
    <CallBatches canCommit={canCommit} reloadKey={reloadKey} onChanged={() => setReloadKey((n) => n + 1)} />
    </>
  );
}

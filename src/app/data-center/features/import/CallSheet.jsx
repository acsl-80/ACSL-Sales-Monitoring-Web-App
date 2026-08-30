import { useEffect, useMemo, useRef, useState } from "react";
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
  const [spec, setSpec] = useState(null);
  const [schema, setSchema] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [partners, setPartners] = useState(null);
  /** True when the partner list could not be fetched, as opposed to being empty. */
  const [partnersFailed, setPartnersFailed] = useState(false);
  /** "" is everything this person may see. Otherwise an organization id. */
  const [orgId, setOrgId] = useState("");
  const [downloaded, setDownloaded] = useState(null); // { rows, partner }
  const [batch, setBatch] = useState(null); // { batchId, staged }
  const [checked, setChecked] = useState(null); // validate summary
  const [result, setResult] = useState(null); // commit summary
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
      const filters = {
        hasCallRecord: false,
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
      const PAGE_LIMIT = 500;
      const MAX_PAGES = 400; // 200,000 records
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
        for (const c of columns) {
          const fill = LOCKED_FROM_QUEUE[c.field];
          out[c.header] = fill ? fill(r) : "";
        }
        return out;
      });

      if (rows.length === 0) {
        setError(
          orgId
            ? "Nothing is waiting to be called for that partner, so the sheet would be empty."
            : "There is nothing waiting to be called, so the sheet would be empty.",
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
          `The sheet stopped at ${rows.length.toLocaleString()} records, which is this download's ceiling. ` +
            "Pick a single partner to bring the rest in.",
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
      const parsed = (await looksLikeWorkbook(file))
        ? await parseWorkbook(file)
        : parseCsv(await file.text());
      const rows = parsed.rows ?? [];

      if (!rows.length) {
        setError("That file has no rows in it.");
        return;
      }
      const staged = await dataCenterImport.callStage(rows, file.name);
      setBatch(staged);
      const summary = await dataCenterImport.callValidate(staged.batchId);
      setChecked(summary);
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "That file could not be read");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commit = async () => {
    if (!batch) return;
    setBusy("commit");
    setError("");
    try {
      let committed = 0;
      const failures = [];
      // Sliced by the server; loop until it says it is done, the same way the
      // receipt commit does, so a long backlog never sits in one request.
      for (let i = 0; i < 200; i++) {
        const out = await dataCenterImport.callCommit(batch.batchId);
        committed += out.committed;
        failures.push(...(out.failures ?? []));
        if (out.done) break;
      }
      // The reasons, read back and grouped. The failures array carries a
      // reason per row and this used to report only how many there were.
      const groups = await groupUnlanded(batch.batchId);
      setResult({ committed, failures, groups });
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "The commit did not finish");
    } finally {
      setBusy("");
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
    } catch (e) {
      setError(e instanceof DataCenterError ? e.message : "The rollback did not finish");
    } finally {
      setBusy("");
    }
  };

  return (
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
            One row per record waiting to be called, with the stove ID, the buyer and the number
            we hold already filled in and locked. Records already called are left out: the import
            refuses them rather than overwriting what the first call found.
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
          <label className="mt-2 block">
            <span className="text-xs font-medium text-gray-700">Whose records</span>
            <select
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setDownloaded(null);
                setError("");
              }}
              disabled={busy === "download" || partners === null}
              className="mt-1 block w-full max-w-md rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-50"
            >
              <option value="">
                {partners === null ? "Loading partners..." : "Everything waiting to be called"}
              </option>
              {(partners ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {[x.name ?? "Unnamed partner", x.branch, x.state].filter(Boolean).join(", ")}
                </option>
              ))}
            </select>
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
          {busy === "upload" && (
            <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" /> reading and checking every row
            </p>
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
            result.failures.length > 0
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <p
            className={`flex items-center gap-2 text-sm font-semibold ${
              result.failures.length > 0 ? "text-amber-900" : "text-emerald-900"
            }`}
          >
            <CircleCheck className="h-4 w-4" /> {plural(result.committed, "call record")} attached
          </p>
          {result.groups?.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-lg border border-amber-200 bg-white">
              <Unlanded groups={result.groups} />
            </div>
          )}
          {result.failures.length > 0 && !result.groups?.length && (
            <p className="mt-1 text-xs text-amber-900">
              {plural(result.failures.length, "row")} did not go through. Open the batch to see why.
            </p>
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
  );
}

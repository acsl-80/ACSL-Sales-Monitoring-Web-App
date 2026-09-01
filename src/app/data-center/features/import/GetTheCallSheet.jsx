import { useEffect, useMemo, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  dataCenterClient,
  dataCenterImport,
  dataCenterWrite,
  DataCenterError,
} from "../../lib/client";
import { buildWorkbook, downloadWorkbook } from "../../lib/xlsx";
import { toCsv, downloadCsv } from "../../lib/export";
import { plural } from "../../lib/plural";
import NumberedStep from "../../components/NumberedStep";
import { Download, Loader2, CircleAlert, CircleCheck } from "lucide-react";

/**
 * Step one: the sheet, built for whoever is going to fill it in.
 *
 * Split out of CallSheet, which had grown to 904 lines against this module's
 * own 600-line rule. The seam is real rather than arbitrary: handing somebody
 * a file and taking one back share no state at all. This half owns the spec,
 * the column list, the partner facet and the row-building; the other half owns
 * the upload, the check and the attach.
 *
 * WHY THE SHEET IS PREFILLED
 *
 * A hand-typed stove ID is the one error the import cannot recover from: a
 * mistyped serial does not look like a typo, it looks like a stove that is not
 * ours. So the stove IDs, the buyer and the number on record come down already
 * filled and locked, and the agent types only what the call told them.
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
  recordVersion: (r) => ((r.call_record_version ?? "") === "" ? "" : String(r.call_record_version)),
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

export default function GetTheCallSheet({ active = true }) {
  const [spec, setSpec] = useState(null);
  const [schema, setSchema] = useState(null);
  const [partners, setPartners] = useState(null);
  /** True when the partner list could not be fetched, as opposed to being empty. */
  const [partnersFailed, setPartnersFailed] = useState(false);
  /** "" is everything this person may see. Otherwise an organization id. */
  const [orgId, setOrgId] = useState("");
  /** Narrow to records nobody has called. Off by default under update mode. */
  const [uncalledOnly, setUncalledOnly] = useState(false);
  const [downloaded, setDownloaded] = useState(null); // { rows, partner }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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
      .catch(
        (e) =>
          live && setError(e instanceof DataCenterError ? e.message : "Could not load the sheet"),
      );
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
        downloadCsv(
          `${stem}.csv`,
          toCsv(
            rows,
            columns.map((c) => c.header),
          ),
        );
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

  return (
    <>
      {error && (
        <p className="mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      <NumberedStep n={1} title="Get the sheet" tone={active ? "active" : "plain"}>
        <p>
          One row per record, with the stove ID, the buyer and the number we hold already filled in
          and locked. A record somebody has already worked comes down with what it currently says,
          so the sheet can correct it as well as fill it in. Its Record Version comes with it, and
          an upload is refused if the record changed in the app after you downloaded, rather than
          quietly overwriting that work.
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
          <label htmlFor="dc-callsheet-partner" className="block text-xs font-medium text-gray-700">
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
                label: [x.name ?? "Unnamed partner", x.branch, x.state].filter(Boolean).join(", "),
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
              Leave this off to bring down everything, which is what makes correcting a record
              possible. Turn it on for a plain backlog run.
            </span>
          </span>
        </label>

        {partnersFailed && (
          <p className="mt-1 flex items-start gap-2 text-sm text-amber-800">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            The partner list could not be loaded, so only the whole queue can be downloaded. Reload
            the page to try again.
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
            No partners are assigned to you, so there is nobody to narrow to. The whole queue is
            what you can see.
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
            {plural(columns.length, "column")}, including{" "}
            {plural(spec?.questions?.length ?? 0, "question")} from the call form. Change them in
            Settings, not here.
          </p>
        )}
      </NumberedStep>
    </>
  );
}

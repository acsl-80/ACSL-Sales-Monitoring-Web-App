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
  Eye, Undo2, Wrench, X, PenLine, Copy, ChevronDown, ChevronRight, Trash2,
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

/** The sources this panel owns. The call sheet has its own list. */
const RECEIPT_SOURCES = ["receipt", "manual", "field", "workbench"];

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

/**
 * What an exception is, and what would actually change it.
 *
 * Three hundred rows in one flat list, each with a "Fix" box beside it, is a
 * wall nobody can work. Worse, most of those boxes could not have helped: a
 * corrected serial fixes a serial that was mistyped, and does nothing at all
 * for a partner the sales app has not been assigned a model for. The button
 * was offered on every row regardless, and on the rows it could not help it
 * was offered anyway.
 *
 * So exceptions are grouped by what is actually wrong, each group says how
 * many rows it holds, and only the groups a serial correction can help get a
 * serial correction. The rest say what WOULD change them, and where.
 */
const EXCEPTION_KINDS = [
  {
    key: "not_in_stock",
    test: (why) => /is not in stock records/i.test(why),
    title: "The stove ID matches nothing in stock",
    fixable: true,
    what:
      "Either the serial was mistyped on the receipt or when it was digitised, or the " +
      "stove was never transferred to a partner. Correct the serial here and the row is " +
      "re-checked on the spot.",
  },
  {
    key: "unassigned_model",
    test: (why) => /is not assigned the/i.test(why),
    title: "The partner has not been assigned this sales model",
    fixable: false,
    what:
      "The sales app refuses a sale whose partner is not assigned that model, so these " +
      "rows would fail at commit. The fix is one assignment per pair in the ERP " +
      "(Partner Sales Models), not a change to the row. Assign them, then press " +
      "Check the rows again and these clear themselves.",
  },
  {
    key: "duplicate",
    test: (why) => /already appears on row/i.test(why),
    title: "The same stove ID appears twice in this file",
    fixable: true,
    what:
      "One of the two rows has the wrong serial. Correct it here, or leave the row - " +
      "the first occurrence still imports.",
  },
  {
    key: "already_sold",
    // Matches the reason the import writes when public.sales itself holds a
    // live sale for the serial. The older wording ("already recorded as sold")
    // was written off the stock flag and is kept in the pattern so a batch
    // staged before that change still groups instead of falling into "other".
    test: (why) => /already has a sale recorded|already (recorded as sold|sold by the time)/i.test(why),
    title: "This receipt is already digitised",
    fixable: true,
    what:
      "A sale already exists for this stove, so the row was not written over it. If the " +
      "serial on this row is mistyped, correct it here and the row is re-checked on the " +
      "spot. If the receipt really is a duplicate of a sale already in the app, leave it. " +
      "If it replaces that sale, cancel the existing one in the sales app first.",
  },
  {
    key: "stock_drift",
    test: (why) => /no live sale exists/i.test(why),
    title: "Stock says sold, but there is no sale",
    fixable: true,
    what:
      "The stove is flagged sold in stock while nothing in the sales app claims it, so a " +
      "sale was removed without the stove being released. Nothing here can fix that. " +
      "Have the stove looked at in the sales app, then press Check the rows again. If " +
      "instead the serial is mistyped, correct it here.",
  },
  {
    key: "moved_partner",
    test: (why) => /moved to a different partner|belongs to a different partner/i.test(why),
    title: "The stove belongs to a different partner",
    fixable: true,
    what:
      "The stove ID resolves to a partner other than the one this row claims. Correct the " +
      "serial if it was mistyped; otherwise the consignment records need looking at.",
  },
  {
    key: "other",
    test: () => true,
    title: "Everything else",
    fixable: true,
    what: "One row at a time. The reason is printed against each.",
  },
];

/** The distinct partner-and-model pairs behind a set of unassigned-model rows. */
function assignmentsNeeded(rows) {
  const pairs = new Map();
  for (const r of rows) {
    const why = r.exception_reason ?? "";
    const partner = why.match(/Partner "([^"]+)"/)?.[1];
    const model = why.match(/the "([^"]+)" sales model/)?.[1];
    if (!partner || !model) continue;
    const key = `${partner}\u0000${model}`;
    pairs.set(key, { partner, model, rows: (pairs.get(key)?.rows ?? 0) + 1 });
  }
  return [...pairs.values()].sort((a, b) => b.rows - a.rows);
}

function ExceptionsQueue({ batchId, canResolve, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState(null);

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

  const groups = useMemo(() => {
    const buckets = EXCEPTION_KINDS.map((k) => ({ ...k, rows: [] }));
    for (const r of rows) {
      const why = r.exception_reason ?? "";
      (buckets.find((b) => b.test(why)) ?? buckets[buckets.length - 1]).rows.push(r);
    }
    return buckets.filter((b) => b.rows.length > 0);
  }, [rows]);

  const resolve = async (row) => {
    /*
     * The value the INPUT is showing, not a separate one.
     *
     * This read `drafts[rowId]` while the input rendered
     * `drafts[rowId] ?? row.stove_serial_no`, so pressing Fix without first
     * editing the box sent an empty string and hit a silent `return`. The
     * field looked filled and the button did nothing at all - the single
     * most reported thing about this screen.
     */
    const serial = (drafts[row.id] ?? row.stove_serial_no ?? "").trim();
    if (!serial) {
      setNote({ id: row.id, text: "Type the correct stove ID first." });
      return;
    }
    setBusy(row.id);
    setNote(null);
    try {
      const out = await dataCenterImport.resolveException(row.id, serial);
      if (!out.resolved) {
        // The correction did not fix it. Say so here rather than letting the
        // row look resolved and fail later at commit.
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, exception_reason: out.reason } : r)));
        setNote({ id: row.id, text: out.reason ?? "That serial did not resolve it." });
      } else {
        await load();
        onChanged?.();
      }
    } catch (err) {
      setNote({
        id: row.id,
        text: err instanceof DataCenterError ? err.message : "That did not go through.",
      });
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
    <div className="divide-y divide-gray-100">
      {groups.map((g) => {
        const isOpen = open === g.key;
        const pairs = g.key === "unassigned_model" ? assignmentsNeeded(g.rows) : [];
        return (
          <div key={g.key}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : g.key)}
              aria-expanded={isOpen}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
            >
              {isOpen
                ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />}
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-gray-900">{g.title}</span>
                <span className="ml-2 text-xs text-gray-600">
                  {plural(g.rows.length, "row")}
                  {pairs.length > 0
                    ? ` · ${plural(pairs.length, "assignment")} to make`
                    : ""}
                </span>
                <span className="mt-0.5 block text-xs text-gray-600">{g.what}</span>
              </span>
            </button>

            {isOpen && pairs.length > 0 && (
              /*
                The work, deduplicated.

                122 rows on the real file were 14 assignments - Solar Sister
                alone appears under five spellings. Listing the rows would be
                the same wall in a different order; listing the PAIRS is the
                actual worklist somebody takes to the ERP.
              */
              <div className="mx-3 mb-2 overflow-hidden rounded-md border border-amber-200 bg-amber-50">
                <p className="border-b border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-900">
                  Assign these in the ERP, then check the batch again
                </p>
                <ul className="divide-y divide-amber-100">
                  {pairs.map((p) => (
                    <li
                      key={`${p.partner}-${p.model}`}
                      className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-xs text-amber-900"
                    >
                      <span className="font-medium">{p.partner}</span>
                      <span className="text-amber-700">needs</span>
                      <span className="font-medium">{p.model}</span>
                      <span className="ml-auto tabular-nums text-amber-700">
                        {plural(p.rows, "row")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isOpen && (
              <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/50">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="w-10 shrink-0 text-xs text-gray-400">#{r.row_number}</span>
                    <span className="min-w-[180px] flex-1 text-amber-800">
                      {r.exception_reason}
                      {note?.id === r.id && (
                        <span className="mt-0.5 block text-xs font-medium text-red-700">
                          {note.text}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {r.raw?.["User First Name"] ?? r.raw?.end_user_name ?? r.raw?.name ?? ""}
                    </span>
                    {canResolve && g.fixable && (
                      <>
                        <input
                          type="text"
                          value={drafts[r.id] ?? r.stove_serial_no ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          placeholder="Correct serial"
                          aria-label={`Corrected stove ID for row ${r.row_number}`}
                          className="w-full min-w-0 rounded-md border sm:w-36 border-gray-300 px-2 py-1 text-sm focus:border-(--dc-accent) focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => resolve(r)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--dc-primary)/30 px-2 py-1 text-xs font-medium text-(--dc-primary) hover:bg-(--dc-primary)/10 disabled:opacity-50"
                        >
                          {busy === r.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Wrench className="h-3 w-3" />}
                          Fix
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
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

/**
 * What to do with a batch next, in one sentence and one button.
 *
 * WHY THIS EXISTS
 *
 * A real 983-row import staged successfully and then sat there. The panel
 * showed "staged", "Rows 983", "Ready 0", "Exceptions 0", and no next step
 * anywhere: the actions were behind a chevron nobody had reason to click, and
 * the one action that batch actually needed - checking the rows - did not exist
 * as a button at all, because checking only ever happened automatically during
 * upload. Staging had worked and the check had not, and there was no way back
 * to it short of re-uploading the same file against a duplicate guard.
 *
 * Meanwhile the top of the page explained three steps the reader had already
 * done. Explaining a process nobody is at the start of is not help.
 *
 * So: the state a batch is in decides the sentence and the button, and both sit
 * on the row rather than inside it.
 */
function nextStep(b) {
  /*
   * A batch the server is writing RIGHT NOW says so, before anything else.
   * Without this, a refreshed page rendered an armed "Commit N" button over a
   * batch a chain was mid-way through - and pressing it answered busy, which
   * read as an error rather than as the truth.
   */
  if (b.committing) {
    return {
      say:
        `Being written on the server right now: ${b.committed_rows} in, ` +
        `${b.valid_rows} to go. This continues on its own - leaving the page is fine.`,
      action: null,
    };
  }
  const pending = Math.max(
    0,
    (b.total_rows ?? 0) - (b.valid_rows ?? 0) - (b.rejected_rows ?? 0) - (b.committed_rows ?? 0),
  );
  /*
   * A finished batch says nothing.
   *
   * The state chip already reads "committed" or "rolled back" and the Committed
   * column already carries the number, so a sentence repeating them earns
   * nothing and costs a row. On a history that only grows, every settled batch
   * would push the one still waiting on somebody further down the page.
   *
   * This row exists for work that needs a person. When there is none, there is
   * no row.
   */
  if (b.state === "rolled_back" || b.state === "committed") return null;
  /*
   * A bench batch whose rows are all still drafts is being typed, not waiting
   * to be checked. `validate` selects staged, valid, rejected and exception
   * rows and never a draft, so the "Check the rows" this used to offer did
   * nothing except flip the batch to `validated` with zero valid rows, which
   * then read as a stuck batch. The row becomes valid when the typist presses
   * Save as finished, and the confirmation queue picks it up from there.
   *
   * A workbench row that is not yet valid, rejected or committed can only be a
   * draft, so `pending` is the draft count for this source without the batches
   * read having to say so.
   */
  if (
    b.source === "workbench" && pending > 0 && (b.valid_rows ?? 0) === 0 &&
    (b.rejected_rows ?? 0) === 0
  ) {
    return {
      say:
        `${plural(pending, "receipt is", "receipts are")} still being typed at the bench. ` +
        "Each one is finished there, then confirmed from the queue.",
      action: null,
    };
  }
  if (pending > 0 && (b.valid_rows ?? 0) === 0 && (b.rejected_rows ?? 0) === 0) {
    return {
      say: `${plural(b.total_rows, "row is", "rows are")} here and none has been checked yet.`,
      action: { kind: "validate", label: "Check the rows", primary: true },
    };
  }
  if ((b.valid_rows ?? 0) > 0) {
    return {
      say:
        `${plural(b.valid_rows, "row is", "rows are")} ready to go in` +
        // "1 needs a person first", "232 need a person first".
        (b.exception_rows
          ? `, ${plural(b.exception_rows, "needs", "need")} a person first`
          : "") +
        `. Nothing is written until you commit.`,
      action: { kind: "commit", label: `Commit ${b.valid_rows}`, primary: true },
    };
  }
  if (pending > 0) {
    return {
      say: `${plural(pending, "row", "rows")} still to check.`,
      action: { kind: "validate", label: "Check the rest", primary: true },
    };
  }
  return {
    say: "Nothing here can be written as it stands. Open it to see why.",
    action: null,
  };
}

export default function ImportPanel({ canUpload, canCommit, canResolve }) {
  const [batches, setBatches] = useState([]);
  // The history grows for as long as the module runs, so it pages.
  // A year of daily imports is a list nobody scrolls.

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  /** What the import is doing now, and what it did. Survives `busy` clearing. */
  const [steps, setSteps] = useState(null);
  const [unlanded, setUnlanded] = useState(null);
  /** Which moment the unlanded list is describing: before a commit, or after. */
  const [unlandedPhase, setUnlandedPhase] = useState("staged");

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
      const all = await dataCenterImport.batches({
        ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
        ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
      });
      /*
       * Receipt batches only.
       *
       * `batches` answers for every source, and a call-centre batch rendered
       * here looked exactly like a receipt one: same counts, same state chip,
       * same next-step button. Pressing it ran the RECEIPT validate or commit
       * over rows whose `normalized` is `{values, attempts}`, which is not a
       * sale. The server refuses that now, but a button that exists only to
       * be refused is still the wrong button.
       *
       * Older batches predate the column, so a missing source reads as a
       * receipt rather than vanishing from the history.
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
            `${counts.rejected} could not be read` +
            // Rows that WILL land but disagreed with the sheet about something
            // the stove ID overrules. Said, because the alternative is a note
            // computed and thrown away.
            (counts.noted ? `, ${counts.noted} with a note` : ""),
        );
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
            /*
             * The counts belong to the step, not to this line as well.
             *
             * Both said "2 ready, 2 need a look, 0 could not be read" on the
             * same screen, one under the other, and a Playwright selector
             * matching that phrase resolved to two elements - which is the
             * cheap version of the reader's problem: the same three numbers
             * twice, in two shapes, with nothing saying they are the same three.
             */
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

  /*
   * While any batch is being written server-side, keep the list fresh.
   *
   * The chain does not need this - it runs regardless - but a person looking
   * at the page deserves numbers that move. Five seconds matches the commit
   * watcher's own cadence, and the poll asks only when a lease is live.
   */
  useEffect(() => {
    /*
     * Poll while a chain holds a lease - AND while a batch sits part-committed
     * without one. Between links the lease clears for a breath, and a page
     * that mounts inside that breath would otherwise freeze on stale numbers
     * forever, showing an armed Commit over a running chain. Part-committed
     * and open is exactly the state worth watching either way.
     */
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
   * Commit, one slice at a time, until the batch is done.
   *
   * The loop lives here rather than on the server so no single request runs
   * long and the operator can watch it move. A failure stops the loop with the
   * batch part-committed, which is recoverable: asking again resumes.
   */
  /**
   * Check a batch that is sitting unchecked.
   *
   * Checking used to happen only as the second half of an upload, so a batch
   * whose upload staged and then failed had no way to be checked at all. It is
   * the same call either way; it just needed a door.
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
      stepTo(
        "check",
        "done",
        `${counts.valid} ready, ${counts.exception} need a look, ` +
          `${counts.rejected} could not be read` +
          (counts.noted ? `, ${counts.noted} with a note` : ""),
      );
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
   * The old loop lived here - one HTTP call per slice, the whole run inside
   * one try, so the FIRST slow slice aborted everything with "took too long"
   * while the server kept working. Measured per-sale latency swings 4s to 30s
   * within a day, so that abort was routine, and a 655-row file needed the
   * tab babysat for up to five hours.
   *
   * Now the press kicks the server's own chain (it answers in about a
   * second), and this function only WATCHES: poll the batch's live counts
   * every five seconds, narrate movement, and stop when the server says
   * committed. Closing the page changes nothing - the chain does not know or
   * care that anybody is looking.
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
           * no movement is a slow link (create-sale at its worst is ~30s a
           * sale); no lease and no movement is a chain that died - a logout
           * mid-run does this, since every link re-validates the session.
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
      stepTo("write", "failed", "Paused. Pressing Commit continues from where it reached.");
      await collectUnlanded(batchId);
      setError(err instanceof DataCenterError ? err.message : "Commit paused. Press Commit to continue.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Clear away a batch that never became sales.
   *
   * The list had no way to remove anything: a staged file nobody committed, a
   * dry run somebody reconsidered, a bench batch a typist abandoned. Rollback
   * does not appear for them - it exists to undo sales and these have none -
   * so they accumulated with no exit at all.
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
       * its own try now, so one slow slice pauses the run instead of dressing
       * a resumable state as a failure. The server refuses outright while a
       * commit chain holds the batch (409 commit_in_progress), and that
       * message is shown as-is.
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
         * Nothing moved and the server says it is not done: every sale still
         * standing was refused by delete-sale, and the reason is in the body.
         * This used to fall through to the success notice below, so an
         * operator without delete rights was told "Rolled back. 0 sales
         * reversed." over a batch that had not changed at all. The server was
         * honest the whole time; the panel was not reading it.
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
    : pending?.kind === "discard"
      ? {
        title: "Discard this batch?",
        body: pending.count > 0
          ? `${plural(pending.count, "part-typed record")} will be thrown away. No sales are ` +
            "affected - this batch never wrote any."
          : "This clears the batch off the list. No sales are affected - it never wrote any.",
        action: "Discard",
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
    else if (kind === "discard") runDiscard(batchId);
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
      <Unlanded groups={unlanded} phase={unlandedPhase} />

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

              {/*
                The next step, on the row rather than inside it.

                A batch that needs something from a person should say so where
                the person is already looking, not behind a chevron they have no
                reason to click.
              */}
              {(() => {
                const step = nextStep(b);
                if (!step) return null;
                const may =
                  step.action?.kind === "commit" ? canCommit : canUpload;
                return (
                  <tr className="border-b border-gray-100 bg-(--dc-accent-soft)/25">
                    <td colSpan={8} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm text-gray-800">{step.say}</span>
                        {step.action && may && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (step.action.kind === "validate") runValidate(b.id);
                              else setPending({ kind: "commit", batchId: b.id, count: b.valid_rows });
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            {step.action.label}
                          </button>
                        )}
                        {step.action && !may && (
                          <span className="text-xs text-gray-600">
                            Somebody with permission to {step.action.kind === "commit" ? "commit" : "run the check"} has to do this.
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })()}

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
                        {/* "Dry run" is the code's word. This is what it does. */}
                        <Eye className="h-3.5 w-3.5" /> Show what a commit would do
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
                    {/*
                      Discard, for a batch that never wrote a sale.

                      Deliberately NOT offered once anything has committed:
                      that is rollback's job, and rollback removes each sale
                      through delete-sale so its stove is released. The server
                      enforces the same rule by the sale_id column rather than
                      by the status label, so a crash-window row still routes
                      to rollback.
                    */}
                    {canCommit && b.committed_rows === 0 && b.state !== "committed" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setPending({
                            kind: "discard",
                            batchId: b.id,
                            count: Math.max(
                              0,
                              (b.total_rows ?? 0) - (b.valid_rows ?? 0) -
                                (b.rejected_rows ?? 0) - (b.exception_rows ?? 0),
                            ),
                          })}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Discard
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

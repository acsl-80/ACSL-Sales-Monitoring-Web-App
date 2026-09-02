import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import ExportButton from "../../components/ExportButton";
import { journeyOf, REACHED, TROUBLE } from "./journey";
import {
  Loader2, Package, Truck, UserRound, PhoneCall, FileSpreadsheet, History,
  ChevronRight, ChevronDown, Copy, Check, ExternalLink, Flame, PenLine,
  TriangleAlert, CircleDashed, CircleCheck, CircleAlert,
  ChevronUp, Wallet,
} from "lucide-react";

/**
 * One stove, everything that ever happened to it.
 *
 * The module has five surfaces and each answers a different question: which
 * partners are behind, which agents are working, what came in on Tuesday. None
 * of them answers the question people actually walk over and ask, which is
 * "what happened to this one?" - and answering it meant opening Partner
 * Records for the transfer, Stove Records for the sale, the call queue for the
 * verification and the import history for who typed it, then joining four
 * screens by eye.
 *
 * So the serial is the anchor. Everything the module knows hangs off it, on
 * one page, and every name on that page that is itself a thing you can look at
 * is a link to where that thing lives. Following a partner from here lands on
 * the same Partner Records everybody else uses; following an agent lands on
 * their queue. Nothing here is a private copy of another surface.
 *
 * The page is readable for a stove that has barely started - issued, sitting
 * with a partner, never sold. That is the majority of the register, and a page
 * that only worked for finished records would be a page for the exceptions.
 */

const NUMBER = new Intl.NumberFormat("en-NG");
const n = (v) => (v == null || v === "" ? null : NUMBER.format(Number(v)));
const money = (v) => (v == null || v === "" ? null : `₦${NUMBER.format(Number(v))}`);
const dateOf = (v) => (v ? new Date(v).toLocaleDateString() : null);
const stamp = (v) => (v ? new Date(v).toLocaleString() : null);
const yesNo = (v) => (v == null ? null : v ? "Yes" : "No");
const words = (v) => (v ? String(v).replace(/_/g, " ") : null);

const OUTCOME_TONE = {
  fully_verified: "bg-(--dc-accent-soft) text-(--dc-accent-strong)",
  partially_verified: "bg-amber-100 text-amber-800",
  unreachable: "bg-orange-100 text-orange-800",
  not_verified: "bg-gray-100 text-gray-700",
};

/* ------------------------------------------------------------------ pieces */

function Section({ icon: Icon, title, note, children, right }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/25 px-4 py-2.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Icon className="h-4 w-4 text-(--dc-accent)" /> {title}
          </h2>
          {note && <p className="mt-0.5 text-xs text-gray-600">{note}</p>}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * A labelled value, and the one thing that makes this page what it is: when a
 * value is itself something you can go and look at, it is a link, not text.
 */
function Detail({ label, value, href, title }) {
  const shown = value ?? null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</p>
      {shown == null || shown === "" ? (
        <p className="mt-0.5 text-sm text-gray-400">not recorded</p>
      ) : href ? (
        <Link
          href={href}
          title={title}
          className="mt-0.5 inline-flex items-baseline gap-1 text-sm font-medium text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 transition hover:decoration-(--dc-accent)"
        >
          <span className="break-words">{shown}</span>
          <ExternalLink className="h-3 w-3 shrink-0 translate-y-0.5" aria-hidden />
        </Link>
      ) : (
        <p className="mt-0.5 break-words text-sm text-gray-900">{shown}</p>
      )}
    </div>
  );
}

function Grid({ children }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <p className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/15 px-4 py-6 text-center text-sm text-gray-600">
      {children}
    </p>
  );
}

/**
 * The instalments behind the running total.
 *
 * This page already showed `total_paid` and `payment_status`, which is a
 * summary of something it never showed. 32 of the 45 rows in production are
 * instalment sales, and `public.installment_payments` had never been read by
 * anything in this module.
 *
 * WHY THE RECONCILIATION LINE IS THE POINT
 *
 * The two sources already disagree. Measured on production: 29 sales where the
 * payments sum to `total_paid`, two flagged instalment and partially paid with
 * no payment rows at all, one carrying payments while not flagged instalment,
 * and one where the sum simply differs. Four in thirty-three.
 *
 * A list printed beside a total that contradicts it is worse than no list,
 * because the reader has no way to know which number to believe and no reason
 * to suspect there is a question. So the disagreement is stated in words, both
 * figures are named, and each is attributed to where it came from.
 *
 * The empty case is stated too. A sale flagged instalment with no payment rows
 * draws a sentence rather than an empty table, because an empty table reads as
 * "nothing was paid" when what it means is "nothing was recorded".
 */
function Payments({ payments, sale }) {
  const rows = payments ?? [];
  const isInstalment = Boolean(sale?.is_installment) || rows.length > 0;
  if (!isInstalment) return null;

  const sum = rows.reduce((t, p) => t + Number(p.amount ?? 0), 0);
  const stated = sale?.total_paid == null ? null : Number(sale.total_paid);
  // Money, compared in whole kobo. Two numerics that are equal to the naira
  // can differ in float, and a reconciliation that cries wolf gets ignored.
  const agree = stated != null && Math.round(sum * 100) === Math.round(stated * 100);

  return (
    <div className="mt-4 rounded-lg border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <Wallet className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Payments</span>
        <span className="text-xs text-gray-500">
          {rows.length === 0 ? "none recorded" : plural(rows.length, "payment")}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-amber-900">
          This sale is marked as an instalment sale
          {sale?.payment_status ? ` and ${words(sale.payment_status)}` : ""}, but no
          payment has been recorded against it. The running total says{" "}
          <span className="font-semibold">{money(sale?.total_paid) ?? "nothing"}</span>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 font-medium">Amount</th>
                <th scope="col" className="px-3 py-2 font-medium">Method</th>
                <th scope="col" className="px-3 py-2 font-medium">Recorded by</th>
                <th scope="col" className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {dateOf(p.payment_date) ?? dateOf(p.created_at) ?? "no date"}
                  </td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{money(p.amount)}</td>
                  <td className="px-3 py-2">{words(p.payment_method) ?? "-"}</td>
                  <td className="px-3 py-2">{p.recorded_by_name ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {p.notes ?? "-"}
                    {p.proof_url && (
                      <a
                        href={p.proof_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-(--dc-accent) underline"
                      >
                        proof
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p
          className={`border-t px-3 py-2 text-sm ${
            agree
              ? "border-gray-100 text-gray-600"
              : "border-amber-200 bg-amber-50 font-medium text-amber-900"
          }`}
        >
          {agree ? (
            <>
              These payments come to {money(sum)}, which matches the total on the
              sale.
            </>
          ) : (
            <>
              These payments come to <span className="font-semibold">{money(sum)}</span>,
              but the sale records{" "}
              <span className="font-semibold">{money(sale?.total_paid) ?? "nothing"}</span>{" "}
              as paid. The two are kept in different places by the sales app and
              they disagree here, so neither is shown as the answer.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Sales this stove used to have.
 *
 * Cancelling a sale releases the stove: the sale keeps its serial, the stock
 * row drops the link and goes back to available. Every other part of this page
 * hangs off that link, so a stove sold and then cancelled read as never sold
 * and the entire episode was invisible - on the one page whose promise is
 * everything that ever happened to this stove.
 *
 * Production carries 28 cancelled sales across 25 serials, so more than one is
 * a real case and this is a list.
 */
function PastSales({ sales }) {
  const rows = sales ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-red-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-red-100 bg-red-50 px-3 py-2">
        <History className="h-4 w-4 text-red-700" />
        <span className="text-sm font-semibold text-red-900">Earlier sales of this stove</span>
        <span className="text-xs text-red-800">{plural(rows.length, "record")}</span>
      </div>
      <ul className="divide-y divide-red-50">
        {rows.map((p) => (
          <li key={p.id} className="px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono font-medium text-gray-900">
                {p.transaction_id ?? "no reference"}
              </span>
              <span className="text-gray-700">{p.end_user_name ?? "no name"}</span>
              {p.sales_date && (
                <span className="text-gray-500">sold {dateOf(p.sales_date)}</span>
              )}
              {money(p.amount) && <span className="text-gray-500">{money(p.amount)}</span>}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.cancelled_at
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-200 text-gray-700"
                }`}
              >
                {p.cancelled_at ? "cancelled" : "archived"}
              </span>
            </div>
            {p.cancelled_at && (
              <p className="mt-1 text-xs text-red-900">
                Cancelled on {dateOf(p.cancelled_at)}
                {p.cancelled_by_name ? ` by ${p.cancelled_by_name}` : ""}
                {p.cancel_reason ? `: ${p.cancel_reason}` : "."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The funnel, for one stove, left to right. */
function Journey({ stages }) {
  return (
    /*
      A grid rather than a scrolling row. Seven stages at a readable width are
      wider than the content column, so a row hid the last of them behind a
      horizontal scroll nobody thinks to try - and the hidden one was Verified,
      which is the stage most people opened the page to see.
    */
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {stages.map((s) => {
        const Icon =
          s.state === REACHED ? CircleCheck : s.state === TROUBLE ? CircleAlert : CircleDashed;
        const tone =
          s.state === REACHED
            ? "border-(--dc-accent)/35 bg-(--dc-accent-soft)/40 text-(--dc-accent-strong)"
            : s.state === TROUBLE
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-gray-200 bg-white text-gray-500";
        return (
          <li
            key={s.key}
            className={`rounded-lg border px-3 py-2 ${tone}`}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {s.title}
            </p>
            <p className="mt-1 text-xs leading-snug">{s.detail}</p>
            {s.when && <p className="mt-0.5 text-[11px] tabular-nums opacity-70">{s.when}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function CopyId({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      aria-label={`Copy ${value}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
    >
      {done ? <Check className="h-4 w-4 text-(--dc-accent)" /> : <Copy className="h-4 w-4" />}
      {done ? "Copied" : "Copy ID"}
    </button>
  );
}

/** The rest of the consignment, fetched only if somebody asks for it. */
/**
 * How many of a long list this page shows before somebody asks for more.
 *
 * Five, everywhere. The stove page is a record, and a record is meant to be
 * read top to bottom: a stove that has been re-called, corrected, sent back to
 * Sales and returned carries dozens of audit rows, and rendering all of them
 * pushed the sale itself so far up the page that the thing people opened the
 * page for was the hardest part to find.
 *
 * The three lists this applies to grow for different reasons - calls by the
 * callback policy, imports by how many times a serial was typed, edits without
 * any ceiling at all - so only the last of them pages against the server. The
 * other two are already bounded by the query that fetched them, and collapsing
 * those in the browser is honest because the browser has all of them.
 */
const FEW = 5;

/**
 * The row that ends a shortened list.
 *
 * It always says the total, because "Show more" on its own does not tell you
 * whether more means two or two hundred, and that changes whether you click.
 */
function More({ shown, total, onMore, onCollapse, busy, noun = "entries" }) {
  const rest = Math.max(0, total - shown);
  const canCollapse = shown > FEW;
  if (rest === 0 && !canCollapse && !busy) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/70 px-3 py-2">
      <span className="text-xs text-gray-500">
        Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      {rest > 0 && (
        <button
          type="button"
          /*
            Wrapped rather than passed straight through. React hands the click
            event to the handler, and both callers take an argument that means
            "collapse instead" - so `onClick={onMore}` expanded nothing and
            collapsed the list on every press.
          */
          onClick={() => onMore()}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-(--dc-accent)/40 px-2 py-1 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Show {Math.min(rest, 20).toLocaleString()} more
        </button>
      )}
      {canCollapse && !busy && (
        <button
          type="button"
          onClick={() => onCollapse()}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 ${rest > 0 ? "" : "ml-auto"}`}
        >
          <ChevronUp className="h-3 w-3" /> Collapse
        </button>
      )}
    </div>
  );
}

/**
 * Everything that changed, newest first, five at a time.
 *
 * Paged against the server rather than sliced in the browser, because this is
 * the one list on the page with no ceiling: the audit trigger writes a row for
 * every edit anybody ever makes to the call record or its assignment batch.
 * Fetching all of them to show five would be reading a history to hide it.
 *
 * The first five and the total arrive with the record itself, so the common
 * case - nobody clicks - costs nothing extra.
 */
function Changes({ saleId, batchId, first, total, hasMore: initialHasMore }) {
  const [rows, setRows] = useState(first);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A different stove is a different history. Without this the page kept the
  // previous stove's rows when navigating between two stove records.
  useEffect(() => {
    setRows(first);
    setCursor(null);
    setHasMore(initialHasMore);
    setError(null);
  }, [first, initialHasMore]);

  const collapse = useCallback(() => {
    setRows(first);
    setCursor(null);
    setHasMore(initialHasMore);
  }, [first, initialHasMore]);

  const showMore = useCallback(
    async () => {
      if (busy) return;
      setBusy(true);
      try {
        const page = await dataCenterClient.stoveChanges({
          saleId: saleId || null,
          batchId: batchId || null,
          limit: 20,
          /*
           * The first call has no cursor of its own, so it is built from the
           * last row already on screen - which is what makes the five
           * delivered with the record continuous with the twenty fetched
           * after it.
           *
           * From `cursor_at`, never from `changed_at`. The second has already
           * been through a JavaScript Date and lost its microseconds, and a
           * cursor a fraction earlier than the row it names skips everything
           * that shares its millisecond.
           */
          cursor:
            cursor ??
            (rows.length > 0
              ? {
                changedAt: rows[rows.length - 1].cursor_at,
                id: String(rows[rows.length - 1].id),
              }
              : null),
        });
        setRows((previous) => [...previous, ...page.rows]);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setError(null);
      } catch (err) {
        setError(
          err instanceof DataCenterError ? err.message : "Could not load more edits.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, cursor, rows, saleId, batchId],
  );

  if (rows.length === 0) {
    return <Empty>Nobody has edited this record since it was created.</Empty>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <ul className="divide-y divide-gray-100">
        {rows.map((c) => (
          <li key={c.id} className="px-3 py-2 text-sm">
            <p className="text-gray-900">
              {/*
                A null actor on an assignment batch is the engine, not an
                unknown person: every human path sets the actor, and the
                scheduled run has nobody to set. Saying "somebody" there
                invites a hunt for a person who does not exist.
              */}
              <span className="font-medium">
                {c.changed_by_name ??
                  c.changed_by_email ??
                  (c.table_name === "assignment_batches"
                    ? "The assignment run"
                    : "Somebody")}
              </span>{" "}
              {c.action === "INSERT"
                ? "created it"
                : c.action === "DELETE"
                  ? "deleted it"
                  : c.changed_fields.length > 0
                    ? `changed ${c.changed_fields.map((f) => f.replace(/_/g, " ")).join(", ")}`
                    : "saved it with nothing changed"}
            </p>
            <p className="text-xs text-gray-500">
              {stamp(c.changed_at)} · {c.table_name.replace(/_/g, " ")}
            </p>
          </li>
        ))}
      </ul>
      {error && (
        <p className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </p>
      )}
      {(hasMore || rows.length > FEW) && (
        <More
          shown={rows.length}
          total={Math.max(total, rows.length)}
          onMore={showMore}
          onCollapse={collapse}
          busy={busy}
          noun="edits"
        />
      )}
    </div>
  );
}

function Siblings({ transferId, stoveId, transactionId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || rows || !transferId) return;
    let live = true;
    dataCenterClient
      .batchStoves(transferId)
      .then((r) => live && setRows(r.stoves ?? []))
      .catch((err) =>
        live && setError(err instanceof DataCenterError ? err.message : "Could not load the batch."),
      );
    return () => {
      live = false;
    };
  }, [open, rows, transferId]);

  if (!transferId) return null;

  return (
    <div className="mt-4 rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-800 transition hover:bg-gray-50"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        The rest of {transactionId ?? "this consignment"}
        <span className="text-xs font-normal text-gray-500">
          every stove that travelled with this one
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!rows && !error && (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the consignment...
            </p>
          )}
          {rows && rows.length === 0 && <p className="text-sm text-gray-500">Nothing else on it.</p>}
          {rows && rows.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {rows.map((r) => {
                const here = r.stove_id === stoveId;
                return (
                  <li key={r.stove_id}>
                    {here ? (
                      <span className="inline-block rounded-md bg-(--dc-accent) px-2 py-1 font-mono text-xs text-white">
                        {r.stove_id}
                      </span>
                    ) : (
                      <Link
                        href={`/data-center/stove/${encodeURIComponent(r.stove_id)}`}
                        className={`inline-block rounded-md border px-2 py-1 font-mono text-xs transition hover:border-(--dc-accent) hover:text-(--dc-accent) ${
                          r.sale_id
                            ? "border-(--dc-accent)/30 bg-(--dc-accent-soft)/25 text-gray-800"
                            : "border-gray-200 text-gray-500"
                        }`}
                        title={r.sale_id ? `sold to ${r.end_user_name ?? "someone"}` : "not sold"}
                      >
                        {r.stove_id}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- page  */

export default function StoveRecord({ stoveId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // How much of the two bounded lists is on screen. Reset whenever the stove
  // changes, so opening a second record does not inherit the first's state.
  const [callsShown, setCallsShown] = useState(FEW);
  const [provenanceShown, setProvenanceShown] = useState(FEW);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    dataCenterClient
      .stoveDetail(stoveId)
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof DataCenterError
            ? err.code === "not_found"
              ? `There is no stove with the ID ${stoveId}. Check the serial against the label, or search for the part you are sure of.`
              : err.message
            : "Could not load that stove.",
        ),
      );
  }, [stoveId]);

  useEffect(load, [load]);

  useEffect(() => {
    setCallsShown(FEW);
    setProvenanceShown(FEW);
  }, [stoveId]);

  const stages = useMemo(
    () => (data ? journeyOf(data) : []),
    [data],
  );

  const shownAttempts = useMemo(
    () => (data?.attempts ?? []).slice(0, callsShown),
    [data, callsShown],
  );
  const shownProvenance = useMemo(
    () => (data?.provenance ?? []).slice(0, provenanceShown),
    [data, provenanceShown],
  );

  /**
   * The whole record as one row, so it can leave as a spreadsheet.
   *
   * One row with many columns rather than a field/value list, because the
   * common reason to export a single record is to paste it beside others.
   */
  const exportShape = useMemo(() => {
    if (!data) return { columns: [], rows: [] };
    const s = data.stove ?? {};
    const sale = data.sale ?? {};
    const e = data.enrichment ?? {};
    const flat = {
      stove_id: s.stove_id,
      stock_status: s.stock_status,
      factory: s.factory,
      partner: s.partner_name,
      partner_id: s.partner_id,
      transfer_reference: s.transaction_id,
      sales_rep: s.sales_rep,
      transferred_on: s.transfer_sales_date,
      transfer_state: s.transfer_state,
      transfer_branch: s.transfer_branch,
      buyer: sale.end_user_name ?? s.end_user_name,
      aka: sale.aka ?? s.aka,
      phone: sale.phone ?? s.phone,
      other_phone: sale.other_phone ?? s.alternative_phone,
      sold_on: sale.sales_date ?? s.sales_date,
      state: sale.state_backup ?? s.user_state,
      lga: sale.lga_backup ?? s.user_lga,
      address: sale.full_address ?? s.user_residential_address,
      amount: sale.amount ?? s.amount,
      paid: sale.total_paid ?? s.total_paid,
      payment_status: sale.payment_status ?? s.payment_status,
      payment_model: sale.payment_model,
      pots: sale.pot_quantity,
      wonderbox: sale.heat_retention_device,
      previous_stove: sale.previous_stove_type,
      meals_per_day: sale.meals_per_day,
      cooking_fuel: sale.cooking_fuel_source,
      cooking_location: sale.cooking_location,
      sold_by: s.sales_rep,
      recorded_by: sale.created_by_name ?? s.sale_agent_name,
      channel: sale.platform ?? s.platform,
      sales_app_status: sale.status ?? s.sale_status,
      verification: e.verification_outcome ?? s.verification_outcome,
      calls_made: e.attempt_count ?? s.attempt_count,
      last_call: e.last_attempt_at ?? s.last_attempt_at,
      call_agent: e.call_agent_name ?? s.agent_name,
      assigned_to: s.agent_name,
      assignment_state: s.batch_state,
      correction_state: s.correction_state,
      sale_id: s.sale_id,
    };
    return {
      columns: Object.keys(flat).map((k) => ({ key: k, label: k.replace(/_/g, " ") })),
      rows: [flat],
    };
  }, [data]);

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-amber-200 border-t-[3px] border-t-amber-400 bg-amber-50 p-6">
        <TriangleAlert className="h-6 w-6 text-amber-600" />
        <h1 className="mt-3 text-base font-semibold text-amber-900">
          Nothing found for {stoveId}
        </h1>
        <p className="mt-1.5 text-sm text-amber-900">{error}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/data-center/stove-records"
            className="rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong)"
          >
            Search the register
          </Link>
          <button
            type="button"
            onClick={load}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Gathering everything about {stoveId}...
      </p>
    );
  }

  const s = data.stove;
  const sale = data.sale;
  const e = data.enrichment;
  const sold = Boolean(s.sale_id);
  const outcome = e?.verification_outcome ?? s.verification_outcome ?? null;

  const partnerHref = s.organization_id
    ? `/data-center/partner-records?organizationId=${encodeURIComponent(s.organization_id)}&partnerName=${encodeURIComponent(s.partner_name ?? "")}`
    : null;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- header */}
      <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Stove ID
            </p>
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-gray-900">
              {s.stove_id}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {/*
                The stock register already says "sold" when it is sold, so the
                second pill said the same word twice in a row. It only earns
                its place when the two disagree - a sale exists but stock has
                not caught up, which is worth seeing.
              */}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {words(s.stock_status) ?? "unknown stock status"}
              </span>
              {sold && s.stock_status !== "sold" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  sold, stock says {words(s.stock_status) ?? "nothing"}
                </span>
              )}
              {outcome && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_TONE[outcome] ?? "bg-gray-100 text-gray-700"}`}
                >
                  {words(outcome)}
                </span>
              )}
              {s.correction_state && s.correction_state !== "none" && (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                  correction {words(s.correction_state)}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.agent_name ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {s.agent_name ? `with ${s.agent_name}` : "unassigned"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyId value={s.stove_id} />
            <ExportButton
              columns={exportShape.columns}
              // A thunk, which is the contract: ExportButton calls rows(),
              // so nothing is built until somebody actually exports.
              rows={() => exportShape.rows}
              filename={`stove-${s.stove_id}.csv`}
              label="Export this record"
            />
          </div>
        </div>
        <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
          <Journey stages={stages} />
        </div>
      </div>

      {/* ------------------------------------------------------- provenance */}
      <Section
        icon={Package}
        title="Where it came from"
        note="The stove register, before anybody sold anything."
      >
        <Grid>
          <Detail label="Stove ID" value={s.stove_id} />
          <Detail label="Stock status" value={words(s.stock_status)} />
          <Detail label="Factory" value={s.factory} />
          <Detail label="Sales reference" value={s.sales_reference} />
        </Grid>
      </Section>

      {/* --------------------------------------------------------- transfer */}
      <Section
        icon={Truck}
        title="The transfer"
        note="Who it was sent to, on which consignment, by which rep."
        right={
          data.siblings ? (
            <span className="rounded-full bg-(--dc-accent-soft)/60 px-2.5 py-1 text-xs font-medium text-(--dc-accent-strong)">
              {plural(data.siblings.total, "stove")} on this consignment, {data.siblings.sold} sold
            </span>
          ) : null
        }
      >
        {!s.transaction_id ? (
          <Empty>
            This stove has not been transferred to a partner yet, so there is no
            consignment, no rep and nobody to call. It is sitting in the register
            waiting to be sent out.
          </Empty>
        ) : (
          <>
            <Grid>
              <Detail
                label="Partner"
                value={s.partner_name}
                href={partnerHref}
                title="Open this partner in Partner Records"
              />
              <Detail label="Partner ID" value={s.partner_id} />
              <Detail
                label="Transfer reference"
                value={s.transaction_id}
                href={
                  s.organization_id
                    ? `/data-center/stove-records?organizationId=${encodeURIComponent(s.organization_id)}&label=${encodeURIComponent(s.transaction_id)}`
                    : null
                }
                title="Every sold stove from this partner"
              />
              <Detail
                label="Sales rep"
                value={s.sales_rep}
                href={
                  s.sales_rep
                    ? `/data-center/call-centre?transferSalesRep=${encodeURIComponent(s.sales_rep)}&label=${encodeURIComponent(s.sales_rep)}`
                    : null
                }
                title="Everything this rep transferred"
              />
              <Detail label="Transferred on" value={dateOf(s.transfer_sales_date)} />
              <Detail label="State" value={s.transfer_state} />
              <Detail label="Branch" value={s.transfer_branch} />
              <Detail
                label="Paper returned"
                value={
                  data.consignment.length > 0
                    ? `${plural(data.consignment[0].received_count, "record")} on ${dateOf(data.consignment[0].received_at)}`
                    : null
                }
              />
            </Grid>
            <Siblings
              transferId={s.transfer_id}
              stoveId={s.stove_id}
              transactionId={s.transaction_id}
            />
          </>
        )}
      </Section>

      {/* ------------------------------------------------------------- sale */}
      <Section
        icon={UserRound}
        title="The sale"
        note="Where it went, and to whom."
        right={
          /*
           * Cancelled is tested first, and the order is the whole fix.
           *
           * Cancelling a sale also archives it, so on production all 28
           * cancelled sales carry both flags and there is not one row that is
           * archived without being cancelled. Testing `is_archived` first
           * therefore made the red pill unreachable, and every cancelled sale
           * read as the grey "archived" - the sales app saying cancelled while
           * this said archived about the same stove.
           *
           * `is_archived` keeps its own branch rather than being deleted,
           * because archived-without-cancellation is a state the column can
           * express and would otherwise silently come back wearing the wrong
           * word.
           */
          sale?.cancelled_at ? (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
              cancelled
            </span>
          ) : sale?.is_archived ? (
            <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700">
              archived
            </span>
          ) : null
        }
      >
        {!sold ? (
          <>
            {/*
              "Not sold yet" is false for a stove whose sale was cancelled.
              Cancelling releases the stove, so it returns here as available
              stock and this branch is exactly where such a stove lands - while
              the sentence told the reader nothing had ever happened to it.
            */}
            {(data.pastSales ?? []).length > 0 ? (
              <Empty>
                Not sold at the moment. It is back with{" "}
                {s.partner_name ?? "the partner"} as available stock because an
                earlier sale was cancelled, which released it. That sale is below.
              </Empty>
            ) : (
              <Empty>
                Not sold yet. It is with {s.partner_name ?? "the partner"} as available
                stock, so there is no buyer to record and nobody to call about it.
              </Empty>
            )}
            <PastSales sales={data.pastSales} />
          </>
        ) : (
          <>
            <Grid>
              <Detail label="Buyer" value={sale?.end_user_name ?? s.end_user_name} />
              <Detail label="Also known as" value={sale?.aka ?? s.aka} />
              <Detail
                label="Phone"
                value={sale?.phone ?? s.phone}
                title="One stove to one phone number: this is the buyer's only link to this stove"
              />
              <Detail label="Other phone" value={sale?.other_phone ?? s.alternative_phone} />
              <Detail label="Contact person" value={sale?.contact_person} />
              <Detail label="Contact phone" value={sale?.contact_phone} />
              <Detail label="Sold on" value={dateOf(sale?.sales_date ?? s.sales_date)} />
              {/*
                Named for the system it belongs to. "Transfer reference" sits a
                few rows above and this one is a different thing entirely - one
                names the consignment from the ERP, the other names the sale in
                the sales app. Two fields both called an ID is how somebody
                quotes the wrong one down a phone.
              */}
              <Detail label="Sales app reference" value={sale?.transaction_id} />
              <Detail label="State" value={sale?.state_backup ?? s.user_state} />
              <Detail label="LGA" value={sale?.lga_backup ?? s.user_lga} />
              <Detail
                label="Address"
                value={sale?.full_address ?? s.user_residential_address}
              />
              <Detail label="City" value={sale?.city} />
              <Detail label="Amount" value={money(sale?.amount ?? s.amount)} />
              <Detail label="Paid" value={money(sale?.total_paid ?? s.total_paid)} />
              <Detail label="Payment status" value={words(sale?.payment_status ?? s.payment_status)} />
              <Detail
                label="Payment model"
                value={
                  sale?.payment_model
                    ? sale.duration_months
                      ? `${sale.payment_model} (${plural(sale.duration_months, "month")})`
                      : sale.payment_model
                    : sale?.is_installment
                      ? "installment"
                      : null
                }
              />
              {/*
                Two different facts, and conflating them is what put one
                uploader's name against 664 sales. "Sold by" is the rep on the
                parent transfer. "Recorded by" is created_by, which on a
                digitised receipt is whoever ran the import.

                sold_on_behalf_of is preferred when it is set, because a sale
                keyed by one person for another is a deliberate statement. It
                is null on all 701 production sales today: create-sale accepts
                no such argument, so nothing has ever written it.
              */}
              <Detail label="Sold by" value={sale?.sold_on_behalf_of_name ?? s.sales_rep} />
              <Detail label="Recorded by" value={sale?.created_by_name ?? s.sale_agent_name} />
              <Detail label="Retailer branch" value={sale?.retailer_branch} />
              <Detail label="Channel" value={sale?.platform ?? s.platform} />
              <Detail label="Sales app status" value={words(sale?.status ?? s.sale_status)} />
              <Detail
                label="Approved"
                value={
                  sale?.agent_approved
                    ? `${sale.approved_by_name ?? "yes"}, ${dateOf(sale.agent_approved_at)}`
                    : sale
                      ? "not approved"
                      : null
                }
              />
            </Grid>
            {data.phoneTwins.length > 0 && (
              /*
                One stove to one phone. create-sale refuses a second sale on a
                live number, so reaching this means the register was written
                round that door - a legacy row, a restore, a direct edit. It is
                shown loudly because the consequence is quiet: an agent rings
                the number, is told about a different stove, and marks the
                wrong record verified.
              */
              <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-red-900">
                  <TriangleAlert className="h-4 w-4" />
                  This phone number is on {plural(data.phoneTwins.length, "other sale")}
                </p>
                <p className="mt-1 text-sm text-red-900">
                  One stove goes to one phone number. Whoever rings it cannot know
                  which stove they are calling about, so both records need
                  checking before either is verified.
                </p>
                <p className="mt-1 text-xs text-red-800">
                  Matched on the last ten digits, so the country code makes no
                  difference: +234 803 123 4567, 234 803 123 4567 and 0803 123 4567
                  are one subscriber. These all share{" "}
                  <span className="font-mono">
                    {String(sale?.phone ?? s.phone ?? "").replace(/\D+/g, "").slice(-10)}
                  </span>.
                </p>
                <ul className="mt-2 space-y-1">
                  {data.phoneTwins.map((t) => (
                    <li key={t.transaction_id ?? t.stove_serial_no} className="text-sm">
                      {t.stove_id ? (
                        <Link
                          href={`/data-center/stove/${encodeURIComponent(t.stove_id)}`}
                          className="font-mono font-medium text-red-900 underline"
                        >
                          {t.stove_id}
                        </Link>
                      ) : (
                        <span className="font-mono font-medium text-red-900">
                          {t.stove_serial_no ?? "an unknown serial"}
                        </span>
                      )}
                      <span className="text-red-800">
                        {" "}
                        — {t.end_user_name ?? "no name"}
                        {t.sales_date ? `, sold ${dateOf(t.sales_date)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Payments payments={data.payments} sale={sale} />

            <PastSales sales={data.pastSales} />

            {sale?.cancelled_at && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                Cancelled on {dateOf(sale.cancelled_at)}
                {sale.cancelled_by_name ? ` by ${sale.cancelled_by_name}` : ""}
                {sale.cancel_reason ? `: ${sale.cancel_reason}` : "."}
              </p>
            )}
          </>
        )}
      </Section>

      {/* ------------------------------------------------- what was in it */}
      {sold && sale && (
        <Section
          icon={Flame}
          title="What was in the box, and how they cook"
          note="The rest of the Sell Stove form, as it was filled in."
        >
          <Grid>
            <Detail label="Pots" value={n(sale.pot_quantity)} />
            <Detail label="Wonderbox" value={yesNo(sale.heat_retention_device)} />
            <Detail
              label="Previous stove"
              value={
                sale.previous_stove_type === "other"
                  ? (sale.previous_stove_other ?? "other")
                  : words(sale.previous_stove_type)
              }
            />
            <Detail label="Meals a day" value={sale.meals_per_day} />
            <Detail label="Cooking fuel" value={words(sale.cooking_fuel_source)} />
            <Detail label="Cooks" value={words(sale.cooking_location)} />
          </Grid>
          <Terms accepted={sale.terms_accepted} />
        </Section>
      )}

      {/* -------------------------------------------------------- paperwork */}
      {sold && sale && (
        <Section
          icon={PenLine}
          title="Paperwork"
          note="What was signed and photographed at the point of sale."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Proof label="Signature" src={sale.signature} alt="the buyer's signature" />
            <Proof label="Stove photograph" src={sale.stove_image_url} alt="the stove" />
            <Proof label="Signed agreement" src={sale.agreement_image_url} alt="the agreement" />
          </div>
        </Section>
      )}

      {/* ----------------------------------------------------- verification */}
      <Section
        icon={PhoneCall}
        title="Verification"
        note="What the call centre found, and who has it."
      >
        {!sold ? (
          <Empty>Nothing to verify until it is sold.</Empty>
        ) : (
          <>
            <Grid>
              <Detail label="Outcome" value={words(outcome) ?? "nothing concluded"} />
              <Detail label="Calls made" value={n(e?.attempt_count ?? s.attempt_count) ?? "0"} />
              <Detail label="Last call" value={stamp(e?.last_attempt_at ?? s.last_attempt_at)} />
              <Detail label="Last outcome" value={e?.call_outcome ?? words(s.call_outcome)} />
              <Detail
                label="Assigned to"
                value={s.agent_name ?? "nobody yet"}
                href={
                  s.agent_id
                    ? `/data-center/call-centre?assignedAgent=${encodeURIComponent(s.agent_id)}&label=${encodeURIComponent(s.agent_name ?? "that agent")}`
                    : null
                }
                title="Open this agent's queue"
              />
              <Detail label="Assignment state" value={words(s.batch_state)} />
              <Detail label="Assigned on" value={dateOf(s.assigned_at)} />
              <Detail label="Enriched by" value={e?.call_agent_name} />
            </Grid>

            {e && (e.corrected_phone || e.corrected_end_user_name || e.corrected_address ||
              e.corrected_state || e.corrected_lga || e.corrected_alt_phone) && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  Corrected on the call
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  What the buyer said, where it differs from the receipt. The receipt
                  above is left as written; these are what the module treats as true.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                  <Detail label="Name" value={e.corrected_end_user_name} />
                  <Detail label="Phone" value={e.corrected_phone} />
                  <Detail label="Other phone" value={e.corrected_alt_phone} />
                  <Detail label="Address" value={e.corrected_address} />
                  <Detail label="State" value={e.corrected_state} />
                  <Detail label="LGA" value={e.corrected_lga} />
                </div>
              </div>
            )}

            {e && (e.ward || e.landmark || e.stated_serial || e.other_comments) && (
              <div className="mt-4">
                <Grid>
                  <Detail label="Ward" value={e.ward} />
                  <Detail label="Landmark" value={e.landmark} />
                  <Detail label="Serial they read out" value={e.stated_serial} />
                  <Detail label="Comments" value={e.other_comments} />
                </Grid>
              </div>
            )}

            <Answers answers={e?.answers} />

            {(s.correction_state && s.correction_state !== "none") && (
              <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-900">
                  Sent back to Sales
                </p>
                <p className="mt-1 text-sm text-purple-900">
                  {words(s.correction_state)}
                  {e?.correction_reason ? `: ${e.correction_reason}` : ""}
                  {e?.correction_requested_by_name
                    ? `, raised by ${e.correction_requested_by_name}`
                    : ""}
                  {e?.correction_requested_at ? ` on ${dateOf(e.correction_requested_at)}` : ""}
                  {e?.correction_resolved_at
                    ? `, resolved ${dateOf(e.correction_resolved_at)}${e.correction_resolved_by_name ? ` by ${e.correction_resolved_by_name}` : ""}`
                    : ""}
                  .
                </p>
                {e?.correction_note && (
                  <p className="mt-1 text-sm text-purple-900">{e.correction_note}</p>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      {/* ------------------------------------------------------- every call */}
      <Section
        icon={PhoneCall}
        title="Every call"
        note="In the order they were made."
      >
        {data.attempts.length === 0 ? (
          <Empty>
            {sold
              ? "Nobody has rung this buyer yet."
              : "Nothing to call about until it is sold."}
          </Empty>
        ) : (
          <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {shownAttempts.map((a) => (
              <li key={a.attempt_no} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-sm">
                <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-gray-400">
                  {a.attempt_no}
                </span>
                <span className="font-medium text-gray-900">
                  {a.outcome ?? "no outcome recorded"}
                </span>
                {a.answered_by && (
                  <span className="text-xs text-gray-600">answered by {a.answered_by}</span>
                )}
                <span className="text-xs text-gray-500">{stamp(a.attempted_at)}</span>
                {a.logged_by && (
                  <span className="text-xs text-gray-500">logged by {a.logged_by}</span>
                )}
                {a.note && <p className="w-full pl-8 text-xs text-gray-600">{a.note}</p>}
              </li>
            ))}
            {/* Bounded by the callback policy, so every attempt is already in
                hand: this only decides how many are on screen. */}
            <More
              shown={shownAttempts.length}
              total={data.attempts.length}
              onMore={() => setCallsShown(data.attempts.length)}
              onCollapse={() => setCallsShown(FEW)}
              noun="calls"
            />
          </ol>
        )}
      </Section>

      {/* ------------------------------------------------------- provenance */}
      <Section
        icon={FileSpreadsheet}
        title="How it got here"
        note="Which file, which bench, whose hands."
      >
        {data.provenance.length === 0 ? (
          <Empty>
            {sold
              ? "This sale was entered in the sales app itself rather than typed up from paper, so there is no import to show."
              : "Nothing has been imported against this stove."}
          </Empty>
        ) : (
          <ul className="space-y-2">
            {shownProvenance.map((p) => (
              <li
                key={`${p.batch_id}-${p.row_number}`}
                className="rounded-lg border border-gray-200 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">
                    {p.source === "manual"
                      ? "Typed at the digitalisation bench"
                      : (p.filename ?? "an uploaded file")}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      row {p.row_number}
                    </span>
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.status === "committed"
                        ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                        : p.status === "rejected"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {words(p.status)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Detail label="Uploaded" value={stamp(p.uploaded_at)} />
                  <Detail label="By" value={p.uploaded_by_name} />
                  <Detail label="Confirmed" value={stamp(p.confirmed_at)} />
                  <Detail label="By" value={p.confirmed_by_name ?? p.committed_by_name} />
                </div>
                {(p.rejection_reason || p.exception_reason) && (
                  <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">
                    {p.rejection_reason ?? p.exception_reason}
                    {p.rejection_hint ? ` — ${p.rejection_hint}` : ""}
                  </p>
                )}
              </li>
            ))}
            {/* The server caps this at twenty, so the total here is the total
                on screen once expanded - never a promise it cannot keep. */}
            <li className="overflow-hidden rounded-lg border border-gray-200">
              <More
                shown={shownProvenance.length}
                total={data.provenance.length}
                onMore={() => setProvenanceShown(data.provenance.length)}
                onCollapse={() => setProvenanceShown(FEW)}
                noun="imports"
              />
            </li>
          </ul>
        )}
      </Section>

      {/* ---------------------------------------------------------- changes */}
      <Section
        icon={History}
        title="Everything that changed"
        note={
          data.changesTotal > FEW
            ? `The newest ${FEW} of ${data.changesTotal.toLocaleString()}. Newest first.`
            : "Edits to this record, newest first."
        }
      >
        <Changes
          saleId={s.sale_id ?? null}
          batchId={s.batch_id ?? null}
          first={data.changes}
          total={data.changesTotal}
          hasMore={data.changesHasMore}
        />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- sub-blocks */

/** The six consents, as ticked or not. */
function Terms({ accepted }) {
  const entries = useMemo(() => {
    if (!accepted || typeof accepted !== "object") return [];
    return Object.entries(accepted);
  }, [accepted]);

  if (entries.length === 0) return null;
  const yes = entries.filter(([, v]) => v === true).length;

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        Terms accepted{" "}
        <span className="font-normal normal-case text-gray-500">
          ({yes} of {entries.length})
        </span>
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {entries.map(([key, value]) => (
          <li
            key={key}
            className={`rounded-md px-2 py-1 text-xs ${
              value
                ? "bg-(--dc-accent-soft)/60 text-(--dc-accent-strong)"
                : "bg-gray-100 text-gray-500 line-through"
            }`}
          >
            {key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The call form's own answers.
 *
 * Rendered from whatever keys are there rather than a fixed list, because the
 * questionnaire is edited in Settings and a hard-coded list here would silently
 * stop showing any question added after this file was written.
 */
function Answers({ answers }) {
  const entries = useMemo(() => {
    if (!answers || typeof answers !== "object") return [];
    return Object.entries(answers).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  }, [answers]);

  if (entries.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
        Answers from the call form
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {entries.map(([key, value]) => (
          <Detail
            key={key}
            label={key.replace(/_/g, " ")}
            value={
              typeof value === "boolean"
                ? yesNo(value)
                : Array.isArray(value)
                  ? value.join(", ")
                  : String(value)
            }
          />
        ))}
      </div>
    </div>
  );
}

/** A signature or a photograph, or an honest gap where one should be. */
function Proof({ label, src, alt }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</p>
      {src ? (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block overflow-hidden rounded-lg border border-gray-200 transition hover:border-(--dc-accent)"
        >
          <img
            src={src}
            alt={alt}
            className="h-32 w-full bg-gray-50 object-contain"
            loading="lazy"
          />
        </a>
      ) : (
        <p className="mt-1 flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 text-center text-xs text-gray-500">
          None on the record
        </p>
      )}
    </div>
  );
}

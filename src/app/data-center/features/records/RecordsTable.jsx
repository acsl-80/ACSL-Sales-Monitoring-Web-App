import { useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { useRecords, PAGE_SIZE, MAX_RETAINED } from "../../lib/useRecords";
import { useRecordFacets } from "../../lib/useRecordFacets";
import RecordsFilters from "./RecordsFilters";
import PeriodFilter from "../../components/PeriodFilter";
import { usePeriod } from "../../lib/usePeriod";
import { useVirtualRows } from "../../lib/useVirtualRows";
import { useIsPhone } from "../../lib/useMediaQuery";
import { Loader2, AlertTriangle, X, Database, Filter } from "lucide-react";

/**
 * Table 1: sold stove records.
 *
 * Three rules this component exists to keep:
 *
 *  1. It never filters, sorts or searches what it already has. Every one of
 *     those changes a request and starts again from the first page, because
 *     narrowing in the browser answers from whatever happens to be loaded.
 *  2. It never asks for a page number. Paging forward means handing back the
 *     cursor the server gave it.
 *  3. It renders a window, not a list. Scrolled to row 40,000 the DOM still
 *     holds roughly thirty rows.
 */

const ROW_HEIGHT = 44;
/** A phone renders one record as a stack. See PhoneRow below. */
const ROW_HEIGHT_PHONE = 104;

const COLUMNS = [
  { key: "sales_date", label: "Sale Date", width: "104px" },
  { key: "stove_serial_no", label: "Stove Serial", width: "128px" },
  { key: "end_user_name", label: "End User", width: "180px" },
  { key: "primary_phone", label: "Phone", width: "124px" },
  { key: "partner_name", label: "Partner", width: "160px" },
  { key: "user_state", label: "State", width: "104px" },
  { key: "user_lga", label: "LGA", width: "128px" },
  { key: "sales_model", label: "Model", width: "128px" },
  { key: "amount", label: "Amount", width: "104px", align: "right" },
  { key: "payment_status", label: "Payment", width: "116px" },
  { key: "sale_status", label: "Status", width: "104px" },
];

const NAIRA = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function cellValue(row, key) {
  const raw = row[key];
  if (raw === null || raw === undefined || raw === "") return "—";
  if (key === "amount") return NAIRA.format(Number(raw));
  if (key === "payment_status" || key === "sale_status") {
    return String(raw).replace(/_/g, " ");
  }
  return String(raw);
}

const STATUS_TONE = {
  completed: "bg-(--dc-primary)/10 text-(--dc-accent)",
  incomplete: "bg-amber-100 text-amber-800",
  pending: "bg-blue-100 text-blue-800",
  assigned: "bg-purple-100 text-purple-800",
  fully_paid: "bg-(--dc-primary)/10 text-(--dc-accent)",
  partially_paid: "bg-amber-100 text-amber-800",
  not_applicable: "bg-gray-100 text-gray-600",
};

/**
 * The serial, as a way in.
 *
 * Every row in this table is about one stove, and the serial is the only
 * column that names a thing with a page of its own. Making it a link is what
 * turns a table of sales into a way to reach any one of their histories.
 */
function SerialLink({ serial, className = "" }) {
  if (!serial) return <span className={className}>—</span>;
  return (
    <Link
      href={`/data-center/stove/${encodeURIComponent(serial)}`}
      onClick={(e) => e.stopPropagation()}
      title={`Everything about ${serial}`}
      className={`font-mono text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 transition hover:decoration-(--dc-accent) ${className}`}
    >
      {serial}
    </Link>
  );
}

function Cell({ row, column }) {
  const value = cellValue(row, column.key);
  if (column.key === "stove_serial_no") {
    return <SerialLink serial={row.stove_serial_no} className="truncate" />;
  }
  if (column.key === "sale_status" || column.key === "payment_status") {
    const tone = STATUS_TONE[row[column.key]] ?? "bg-gray-100 text-gray-600";
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
        {value}
      </span>
    );
  }
  return <span className="truncate">{value}</span>;
}

/**
 * One record as a card, for a screen too narrow to hold eleven columns.
 *
 * The sale, the stove, who bought it, and where it stands on payment. Enough
 * to recognise a record; the full row is what a desktop is for.
 */
function PhoneRow({ row }) {
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-1 px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
          {row.end_user_name ?? "Unnamed"}
        </span>
        <span className="shrink-0 tabular-nums text-gray-700">
          {cellValue(row, "amount")}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <SerialLink serial={row.stove_serial_no} className="truncate" />
        <span aria-hidden="true">·</span>
        <span className="truncate">{cellValue(row, "partner_name")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Cell row={row} column={{ key: "sale_status" }} />
        <Cell row={row} column={{ key: "payment_status" }} />
        <span className="text-xs text-gray-400">{cellValue(row, "sales_date")}</span>
      </div>
    </div>
  );
}

export default function RecordsTable({ drill = null, routeId = "/data-center/stove-records" }) {
  // Two states, deliberately. `draft` is what the user is typing; `applied` is
  // what has been asked of the server. Debouncing between them is what stops a
  // request per keystroke.
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});
  /*
   * Which end of the register to read from.
   *
   * Held here rather than in the filter panel because it is not a filter: it
   * changes the order the server pages in, so flipping it starts a new first
   * page rather than re-sorting what is loaded. Without it the oldest record
   * in a register of half a million is unreachable except by scrolling past
   * every newer one.
   */
  const [direction, setDirection] = useState("desc");
  const { facets } = useRecordFacets();

  useEffect(() => {
    const timer = setTimeout(() => setApplied(draft), 350);
    return () => clearTimeout(timer);
  }, [draft]);

  // A drill-through from the dashboard narrows the table, and what the user
  // types narrows it further: their filters come last so they always win. The
  // drill lives in the URL, not in state, so back leaves it behind.
  const { period, setPeriod, resolved, earliest } = usePeriod(routeId);

  /**
   * A dashboard drill that carries its own dates outranks the period.
   *
   * Clicking "March" on a chart is a request for March, and a period control
   * quietly reasserting "this year" over it would answer a question nobody
   * asked. So when the drill names dates, it wins and the control steps aside
   * rather than displaying a period the table is not on.
   */
  const drillSetsDates = Boolean(drill?.filters?.dateFrom || drill?.filters?.dateTo);

  /**
   * A date typed into the panel outranks the period, the same way a drill does.
   *
   * The panel now offers "sold on or after" and "sold on or before", and the
   * period control sets exactly those two filters. Merged naively the user's
   * value won for the bound they set and the period kept the other one - so
   * typing a single start date produced "from the date I chose, to the end of
   * whatever period the control still says", which is a range nobody asked
   * for. Worse, the control went on displaying a period the table was not on.
   *
   * So either the period owns the dates or the panel does, never half each.
   */
  const userSetsDates = Boolean(applied.dateFrom || applied.dateTo);
  const periodStandsAside = drillSetsDates || userSetsDates;

  /**
   * Precedence, widest first: the period, then the drill, then what the user
   * typed. Their own filters come last so they always win, which is the rule
   * this table has always followed.
   */
  const filters = useMemo(
    () => ({
      ...(periodStandsAside
        ? {}
        : {
            ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
            ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
          }),
      ...(drill?.filters ?? {}),
      ...applied,
    }),
    [drill, applied, periodStandsAside, resolved.dateFrom, resolved.dateTo],
  );

  const {
    rows, loading, loadingMore, error, hasMore, scope, loadMore,
    total, totalIsCapped, atCeiling,
  } = useRecords(filters, "records", direction);

  const phone = useIsPhone();
  const rowHeight = phone ? ROW_HEIGHT_PHONE : ROW_HEIGHT;

  const { containerRef, window: win, onScroll } = useVirtualRows(
    rows.length,
    rowHeight,
  );

  // Fetch the next page while the user is still ~two pages from the end, so
  // scrolling does not stall waiting on the network.
  useEffect(() => {
    if (hasMore && !loadingMore && win.end > rows.length - PAGE_SIZE / 2) {
      loadMore();
    }
  }, [win.end, rows.length, hasMore, loadingMore, loadMore]);

  const visible = useMemo(
    () => rows.slice(win.start, win.end),
    [rows, win.start, win.end],
  );

  const active = Object.values(draft).some(
    (v) => v !== undefined && v !== "" && v !== false,
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <Database className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Sold Stove Records</span>
        {/*
          "1,247 records" and "100 loaded" answer different questions, and only
          the first tells somebody whether the filter they just set worked. The
          count is bounded server-side, so an unfiltered register says
          "10,000+" rather than spending the time to count half a million rows
          nobody was going to scroll through.
        */}
        <span className="text-sm text-gray-500">
          {loading
            ? "loading..."
            : total == null
              ? `${rows.length.toLocaleString()} loaded${hasMore ? ", more available" : ""}`
              : `${total.toLocaleString()}${totalIsCapped ? "+" : ""} ${
                  total === 1 && !totalIsCapped ? "record" : "records"
                } · ${rows.length.toLocaleString()} loaded`}
        </span>
        {scope && (
          <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            showing {scope}
          </span>
        )}
      </div>

      {/* Where this table came from, when it came from a number on the
          dashboard, with the one way back to everything. */}
      {drill && (
        <div className="flex flex-wrap items-center gap-2 border-y border-(--dc-accent)/25 bg-(--dc-accent-soft)/60 px-4 py-2.5">
          <Filter className="h-3.5 w-3.5 shrink-0 text-(--dc-accent)" />
          <p className="text-sm text-(--dc-accent-strong)">
            Narrowed from the dashboard to <span className="font-medium">{drill.description}</span>
          </p>
          <button
            type="button"
            onClick={drill.clear}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-(--dc-accent) hover:bg-(--dc-accent)/10"
          >
            <X className="h-3.5 w-3.5" /> Show everything
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/20 px-4 py-2.5">
        {drillSetsDates ? (
          <p className="text-xs text-gray-600">
            The dates come from the dashboard figure you followed. Clear the
            narrowing above to choose a period yourself.
          </p>
        ) : userSetsDates ? (
          // Said out loud rather than left to be noticed. A period control
          // still showing "This year" beside a table filtered to one week is
          // the kind of quiet disagreement people plan around.
          <p className="text-xs text-gray-600">
            The dates below are yours, so the period is not being applied.
            Clear them to go back to choosing a period.
          </p>
        ) : (
          <PeriodFilter
            period={period}
            onChange={setPeriod}
            earliest={earliest}
            noun="sales"
          />
        )}
      </div>

      <RecordsFilters
        draft={draft}
        setDraft={setDraft}
        onClear={() => setDraft({})}
        facets={facets}
        direction={direction}
        onDirection={setDirection}
      />

      {error && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="sm:min-w-[1200px]">
          <div
            className="hidden border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong) sm:flex"
            style={{ height: ROW_HEIGHT }}
          >
            {COLUMNS.map((c) => (
              <div
                key={c.key}
                className={`flex shrink-0 items-center px-3 ${c.align === "right" ? "justify-end" : ""}`}
                style={{ width: c.width }}
              >
                {c.label}
              </div>
            ))}
          </div>

          <div
            ref={containerRef}
            onScroll={onScroll}
            className="relative overflow-y-auto"
            style={{ maxHeight: "clamp(320px, 62dvh, 560px)" }}
          >
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading records...
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">
                No records match{active ? " these filters" : ""}.
              </div>
            ) : (
              // The spacer carries the full height so the scrollbar is honest
              // about how much there is; only the window inside it is rendered.
              <div style={{ height: win.totalHeight, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    top: win.offsetTop,
                    left: 0,
                    right: 0,
                  }}
                >
                  {visible.map((row) => (
                    <div
                      key={row.sale_id}
                      className="flex border-b border-gray-100 text-sm text-gray-700 transition hover:bg-(--dc-accent-soft)/50"
                      style={{ height: rowHeight }}
                    >
                      {phone ? (
                        <PhoneRow row={row} />
                      ) : (
                        COLUMNS.map((c) => (
                        <div
                          key={c.key}
                          className={`flex shrink-0 items-center px-3 ${c.align === "right" ? "justify-end" : ""}`}
                          style={{ width: c.width }}
                          title={cellValue(row, c.key)}
                        >
                          <Cell row={row} column={c} />
                        </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
        The ceiling, said out loud.

        Paging forward for ever would eventually hold half a million row objects
        in the tab, which is a browser that stops responding rather than one
        that is slow. Stopping is the right behaviour; stopping without saying
        why would look like the register ending early, so this names the limit,
        the number that matched, and the thing to do about it.
      */}
      {atCeiling && hasMore && (
        <div className="flex flex-wrap items-start gap-2 border-t border-(--dc-accent)/25 bg-(--dc-accent-soft)/50 px-4 py-2.5">
          <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--dc-accent)" />
          <p className="text-xs text-(--dc-accent-strong)">
            <span className="font-semibold">
              {MAX_RETAINED.toLocaleString()} records loaded, the most this table
              holds at once.
            </span>{" "}
            {total != null && (total > MAX_RETAINED || totalIsCapped)
              ? `${total.toLocaleString()}${totalIsCapped ? "+" : ""} match, so there are more below this. `
              : ""}
            Narrow the filters, or turn the sort round to read from the other end.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
        {loadingMore ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Loading more...
          </>
        ) : atCeiling && hasMore ? (
          "Paused at the display limit"
        ) : hasMore ? (
          "Scroll for more"
        ) : rows.length > 0 ? (
          "End of records"
        ) : null}
      </div>
    </div>
  );
}

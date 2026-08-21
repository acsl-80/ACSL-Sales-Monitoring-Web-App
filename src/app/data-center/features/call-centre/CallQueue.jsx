import { useEffect, useMemo, useState } from "react";
import PeriodFilter from "../../components/PeriodFilter";
import { usePeriod } from "../../lib/usePeriod";
import { useRecords, PAGE_SIZE } from "../../lib/useRecords";
import { useIsPhone } from "../../lib/useMediaQuery";
import { plural } from "../../lib/plural";
import { useVirtualRows } from "../../lib/useVirtualRows";
import CallRecordEditor from "./CallRecordEditor";
import { Loader2, AlertTriangle, Search, X, PhoneCall, Filter } from "lucide-react";

/**
 * Table 2: the call centre queue.
 *
 * Same paging contract as Table 1 (cursor forward, no page numbers, windowed
 * rendering), with the filters the process actually runs on. The presets below
 * are the queues people work rather than a generic filter builder: "who has
 * never been called", "who is waiting on Sales", "who we have chased three
 * times and still cannot confirm".
 */

const ROW_HEIGHT = 44;
/**
 * A phone shows one record as a stack, not as a ninth of a wide row.
 *
 * Same virtual window, same data, a different row renderer and a taller row.
 * A second render path would be two tables to keep in step; this is one table
 * that knows how wide it is.
 */
const ROW_HEIGHT_PHONE = 104;

const COLUMNS = [
  { key: "sales_date", label: "Sale Date", width: "100px" },
  { key: "end_user_name", label: "End User", width: "168px" },
  { key: "primary_phone", label: "Phone", width: "120px" },
  { key: "stove_serial_no", label: "Serial", width: "120px" },
  { key: "partner_name", label: "Partner", width: "148px" },
  { key: "verification_outcome", label: "Verification", width: "140px" },
  { key: "attempt_count", label: "Calls", width: "64px", align: "right" },
  { key: "call_outcome", label: "Last Outcome", width: "148px" },
  { key: "correction_state", label: "Correction", width: "108px" },
];

const OUTCOME_TONE = {
  fully_verified: "bg-(--dc-primary)/10 text-(--dc-accent)",
  partially_verified: "bg-amber-100 text-amber-800",
  doubtful_verification: "bg-orange-100 text-orange-800",
  not_verified: "bg-gray-100 text-gray-600",
};

const CORRECTION_TONE = {
  open: "bg-red-100 text-red-700",
  resolved: "bg-blue-100 text-blue-700",
  none: "bg-gray-100 text-gray-500",
};

/**
 * One record as a card, for a screen too narrow to hold nine columns.
 *
 * Carries what an agent needs before dialling: who, which stove, the number,
 * where it stands and how many times it has been tried. The rest is one tap
 * away in the record itself.
 */
function PhoneRow({ row }) {
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-1 px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
          {row.end_user_name ?? "Unnamed"}
        </span>
        <span className="shrink-0 text-xs text-gray-400">
          {cellValue(row, "sales_date")}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="truncate font-mono">{cellValue(row, "stove_serial_no")}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{cellValue(row, "primary_phone")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Cell row={row} column={{ key: "verification_outcome" }} />
        {row.correction_state && row.correction_state !== "none" && (
          <Cell row={row} column={{ key: "correction_state" }} />
        )}
        <span className="text-xs text-gray-400">
          {plural(Number(row.attempt_count ?? 0), "call")}
        </span>
      </div>
    </div>
  );
}

/**
 * The queues a call centre actually works.
 *
 * Presets rather than a filter builder, because the process has a shape: these
 * are the four questions a supervisor asks every morning. The underlying
 * filters remain available to anything that needs them.
 */
const PRESETS = [
  { key: "all", label: "Everything", filters: {} },
  { key: "todo", label: "Never called", filters: { hasCallRecord: false } },
  {
    key: "unresolved",
    label: "Still to verify",
    filters: { verificationOutcome: "not_verified" },
  },
  {
    key: "exhausted",
    label: "Chased 3 times",
    filters: { verificationOutcome: "not_verified", attemptsAtLeast: 3 },
  },
  { key: "correction", label: "Waiting on Sales", filters: { correctionState: "open" } },
];

function cellValue(row, key) {
  const raw = row[key];
  if (raw === null || raw === undefined || raw === "") return key === "attempt_count" ? "0" : "—";
  if (key === "verification_outcome" || key === "correction_state") {
    return String(raw).replace(/_/g, " ");
  }
  return String(raw);
}

function Cell({ row, column }) {
  const value = cellValue(row, column.key);
  if (column.key === "verification_outcome") {
    const tone = OUTCOME_TONE[row.verification_outcome ?? "not_verified"];
    return (
      <span className={`inline-block truncate rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
        {row.verification_outcome ? value : "not verified"}
      </span>
    );
  }
  if (column.key === "correction_state") {
    const state = row.correction_state ?? "none";
    if (state === "none") return <span className="text-gray-300">—</span>;
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CORRECTION_TONE[state]}`}>
        {value}
      </span>
    );
  }
  return <span className="truncate">{value}</span>;
}

export default function CallQueue({ canEdit, drill = null }) {
  // The URL seeds which preset is showing; the chips are the user's after that.
  // Seeding rather than controlling, so clicking a chip is not fighting the
  // address bar on every render.
  const [preset, setPreset] = useState(drill?.preset ?? "all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [openSale, setOpenSale] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { period, setPeriod, resolved, earliest } = usePeriod("/data-center/call-centre");

  /**
   * A drill that names its own dates outranks the period, the same way it does
   * on the records table: following "March" from a chart is a request for
   * March, not an invitation to re-widen it to the year.
   */
  const drillSetsDates = Boolean(drill?.filters?.dateFrom || drill?.filters?.dateTo);

  const filters = useMemo(() => {
    const base = PRESETS.find((p) => p.key === preset)?.filters ?? {};
    // A drill-through narrows whatever the preset says, and it comes from the
    // URL rather than from state, so it survives reloads and back navigation.
    return {
      ...(drillSetsDates
        ? {}
        : {
            ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
            ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
          }),
      ...base,
      ...(drill?.filters ?? {}),
      ...(appliedSearch ? { search: appliedSearch } : {}),
    };
  }, [preset, appliedSearch, drill, drillSetsDates, resolved.dateFrom, resolved.dateTo]);

  const { rows, loading, loadingMore, error, hasMore, scope, loadMore, reload } =
    useRecords(filters, "call_center");

  const phone = useIsPhone();
  const rowHeight = phone ? ROW_HEIGHT_PHONE : ROW_HEIGHT;

  const { containerRef, window: win, onScroll } = useVirtualRows(rows.length, rowHeight);

  useEffect(() => {
    if (hasMore && !loadingMore && win.end > rows.length - PAGE_SIZE / 2) loadMore();
  }, [win.end, rows.length, hasMore, loadingMore, loadMore]);

  const visible = useMemo(() => rows.slice(win.start, win.end), [rows, win.start, win.end]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <PhoneCall className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Call Centre</span>
        <span className="text-sm text-gray-500">
          {loading ? "loading..." : `${rows.length.toLocaleString()} loaded${hasMore ? ", more available" : ""}`}
        </span>
        {scope && (
          <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            showing {scope}
          </span>
        )}
      </div>

      {/* A drill-through from a scorecard, named so the reader knows what
          narrowed the queue, with the one way out: back to the whole queue. */}
      {drill && (
        <div className="flex flex-wrap items-center gap-2 border-b border-(--dc-primary)/20 bg-(--dc-primary-soft)/50 px-4 py-2.5">
          <Filter className="h-3.5 w-3.5 shrink-0 text-(--dc-accent)" />
          <p className="text-sm text-(--dc-accent)">
            Narrowed from the dashboard to <span className="font-medium">{drill.description}</span>
          </p>
          <button
            type="button"
            onClick={drill.clear}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-(--dc-accent-strong) transition hover:bg-(--dc-accent)/10"
          >
            <X className="h-3.5 w-3.5" /> Show everything
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              aria-pressed={preset === p.key}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                preset === p.key
                  ? "border-(--dc-accent) bg-(--dc-accent) text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-600 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50 hover:text-(--dc-accent-strong)"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {!drillSetsDates && (
          <PeriodFilter
            period={period}
            onChange={setPeriod}
            earliest={earliest}
            noun="records"
          />
        )}

        <div className="relative w-full min-w-0 sm:ml-auto sm:w-auto sm:min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone or serial"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="sm:min-w-[1120px]">
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
            // Tall enough to be a working surface, short enough that the page
            // around it is still reachable on a phone without scrolling twice.
            style={{ maxHeight: "clamp(320px, 62dvh, 560px)" }}
          >
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the queue...
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">Nothing in this queue.</div>
            ) : (
              <div style={{ height: win.totalHeight, position: "relative" }}>
                <div style={{ position: "absolute", top: win.offsetTop, left: 0, right: 0 }}>
                  {visible.map((row) => (
                    <button
                      key={row.sale_id}
                      type="button"
                      onClick={() => setOpenSale(row.sale_id)}
                      aria-label={`Open call record for ${row.end_user_name ?? row.stove_serial_no ?? row.sale_id}`}
                      className="flex w-full border-b border-gray-100 text-left text-sm text-gray-700 transition hover:bg-(--dc-accent-soft)/50"
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
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
        {loadingMore ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Loading more...
          </>
        ) : hasMore ? (
          "Scroll for more"
        ) : rows.length > 0 ? (
          "End of queue"
        ) : null}
      </div>

      {openSale && (
        <CallRecordEditor
          saleId={openSale}
          canEdit={canEdit}
          onClose={() => setOpenSale(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

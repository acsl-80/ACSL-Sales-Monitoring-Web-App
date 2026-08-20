import { useEffect, useMemo, useState } from "react";
import { useRecords, PAGE_SIZE } from "../../lib/useRecords";
import { useVirtualRows } from "../../lib/useVirtualRows";
import { Loader2, AlertTriangle, Search, X, Database } from "lucide-react";

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
  completed: "bg-[#4a5d0f]/10 text-[#4a5d0f]",
  incomplete: "bg-amber-100 text-amber-800",
  pending: "bg-blue-100 text-blue-800",
  assigned: "bg-purple-100 text-purple-800",
  fully_paid: "bg-[#4a5d0f]/10 text-[#4a5d0f]",
  partially_paid: "bg-amber-100 text-amber-800",
  not_applicable: "bg-gray-100 text-gray-600",
};

function Cell({ row, column }) {
  const value = cellValue(row, column.key);
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

const SALE_STATUSES = ["incomplete", "completed", "pending", "assigned"];
const PAYMENT_STATUSES = ["not_applicable", "partially_paid", "fully_paid"];

function FilterBar({ draft, setDraft, onClear, active }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-4 py-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={draft.search ?? ""}
          onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          placeholder="Name, phone, stove serial or transaction ID"
          className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-[#4a5d0f] focus:outline-none"
        />
      </div>

      <select
        value={draft.saleStatus ?? ""}
        onChange={(e) => setDraft({ ...draft, saleStatus: e.target.value || undefined })}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#4a5d0f] focus:outline-none"
      >
        <option value="">Any status</option>
        {SALE_STATUSES.map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
        ))}
      </select>

      <select
        value={draft.paymentStatus ?? ""}
        onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value || undefined })}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#4a5d0f] focus:outline-none"
      >
        <option value="">Any payment</option>
        {PAYMENT_STATUSES.map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
        ))}
      </select>

      <input
        type="date"
        value={draft.dateFrom ?? ""}
        onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value || undefined })}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#4a5d0f] focus:outline-none"
        aria-label="Sold from"
      />
      <input
        type="date"
        value={draft.dateTo ?? ""}
        onChange={(e) => setDraft({ ...draft, dateTo: e.target.value || undefined })}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#4a5d0f] focus:outline-none"
        aria-label="Sold to"
      />

      {active && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}

export default function RecordsTable() {
  // Two states, deliberately. `draft` is what the user is typing; `applied` is
  // what has been asked of the server. Debouncing between them is what stops a
  // request per keystroke.
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});

  useEffect(() => {
    const timer = setTimeout(() => setApplied(draft), 350);
    return () => clearTimeout(timer);
  }, [draft]);

  const { rows, loading, loadingMore, error, hasMore, scope, loadMore } =
    useRecords(applied);

  const { containerRef, window: win, onScroll } = useVirtualRows(
    rows.length,
    ROW_HEIGHT,
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

  const active = Object.values(draft).some((v) => v !== undefined && v !== "");

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Database className="h-4 w-4 text-[#4a5d0f]" />
        <span className="text-sm font-semibold text-gray-900">Sold Stove Records</span>
        <span className="text-sm text-gray-500">
          {loading
            ? "loading..."
            : `${rows.length.toLocaleString()} loaded${hasMore ? ", more available" : ""}`}
        </span>
        {scope && (
          <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            showing {scope}
          </span>
        )}
      </div>

      <FilterBar
        draft={draft}
        setDraft={setDraft}
        onClear={() => setDraft({})}
        active={active}
      />

      {error && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[1200px]">
          <div
            className="flex border-b border-gray-200 bg-[#fafafa] text-xs font-semibold uppercase tracking-wide text-gray-500"
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
            style={{ height: 560 }}
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
                      className="flex border-b border-gray-100 text-sm text-gray-700 hover:bg-[#eef3c4]/40"
                      style={{ height: ROW_HEIGHT }}
                    >
                      {COLUMNS.map((c) => (
                        <div
                          key={c.key}
                          className={`flex shrink-0 items-center px-3 ${c.align === "right" ? "justify-end" : ""}`}
                          style={{ width: c.width }}
                          title={cellValue(row, c.key)}
                        >
                          <Cell row={row} column={c} />
                        </div>
                      ))}
                    </div>
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
          "End of records"
        ) : null}
      </div>
    </div>
  );
}

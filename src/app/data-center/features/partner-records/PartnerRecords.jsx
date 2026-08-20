import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { toCsv, downloadCsv } from "../../lib/export";
import {
  Handshake, Loader2, AlertTriangle, Search, X, Clock, Download, TriangleAlert,
} from "lucide-react";

/**
 * Partner Records: what was issued to a partner, against what has come back.
 *
 * The numbers are computed, not counted here. `transfer_funnel` is refreshed by
 * the same run that builds the dashboard, so this page is an indexed read and
 * says when its figures are from. See the top of
 * 20260821010000_data_center_transfers.sql for why counting them live was not
 * an option.
 *
 * The arithmetic worth knowing while reading this:
 *
 *   verified + unverified + unreachable + unresolved  =  digitalised
 *   received - digitalised                            =  the typing backlog
 *   issued - digitalised                              =  still outstanding
 */

const NUMBER = new Intl.NumberFormat("en-NG");

const COLUMNS = [
  { key: "partner_name", label: "Partner", width: "200px" },
  { key: "transaction_id", label: "Reference", width: "116px" },
  { key: "sales_rep", label: "Sales Rep", width: "160px" },
  { key: "transfer_state", label: "State", width: "96px" },
  { key: "sales_date", label: "Sold", width: "100px" },
  { key: "issued_count", label: "Issued", width: "80px", align: "right" },
  { key: "received_count", label: "Received", width: "92px", align: "right" },
  { key: "digitalised_count", label: "Digitalised", width: "100px", align: "right" },
  { key: "verified_count", label: "Verified", width: "88px", align: "right" },
  { key: "outstanding_count", label: "Outstanding", width: "104px", align: "right" },
];

/** A five-segment bar. The whole point of the page in one row. */
function FunnelBar({ row }) {
  const issued = Math.max(1, row.issued_count);
  const seg = (n, tone, title) =>
    n > 0 ? (
      <span
        className={`block h-full ${tone}`}
        style={{ width: `${(n / issued) * 100}%` }}
        title={`${title}: ${NUMBER.format(n)}`}
      />
    ) : null;

  return (
    <span className="flex h-3 w-full overflow-hidden rounded bg-gray-100" aria-hidden="true">
      {seg(row.verified_count, "bg-(--dc-primary)", "Verified")}
      {seg(row.unverified_count, "bg-amber-500", "Unverified")}
      {seg(row.unreachable_count, "bg-orange-500", "Unreachable")}
      {seg(row.unresolved_count, "bg-gray-400", "Yet to be resolved")}
    </span>
  );
}

function cell(row, key) {
  const v = row[key];
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "number" ? NUMBER.format(v) : String(v);
}

export default function PartnerRecords() {
  const [rows, setRows] = useState([]);
  const [computedAt, setComputedAt] = useState(null);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setApplied(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await dataCenterClient.getTransferFunnel({
        limit: 300,
        filters: {
          ...(applied ? { search: applied } : {}),
          ...(outstandingOnly ? { outstandingOnly: true } : {}),
        },
      });
      setRows(page.rows);
      setComputedAt(page.computedAt);
      setScope(page.scope);
      setError(null);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "Could not load partner records.",
      );
    } finally {
      setLoading(false);
    }
  }, [applied, outstandingOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          issued: a.issued + r.issued_count,
          received: a.received + r.received_count,
          digitalised: a.digitalised + r.digitalised_count,
          verified: a.verified + r.verified_count,
          outstanding: a.outstanding + r.outstanding_count,
        }),
        { issued: 0, received: 0, digitalised: 0, verified: 0, outstanding: 0 },
      ),
    [rows],
  );

  const exportCsv = () => {
    downloadCsv(
      "partner-records.csv",
      toCsv(rows, [
        "partner_name", "partner_id", "transaction_id", "sales_rep",
        "transfer_state", "transfer_branch", "sales_date",
        "issued_count", "received_count", "received_is_logged", "digitalised_count",
        "verified_count", "unverified_count", "unreachable_count", "unresolved_count",
        "outstanding_count",
      ]),
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Handshake className="h-4 w-4 text-(--dc-primary)" />
        <span className="text-sm font-semibold text-gray-900">Partner Records</span>
        <span className="text-sm text-gray-500">
          {loading ? "loading..." : `${NUMBER.format(rows.length)} transfer(s)`}
        </span>
        {computedAt && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            computed {new Date(computedAt).toLocaleString()}
          </span>
        )}
        {scope && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            showing {scope}
          </span>
        )}
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-4 py-3 sm:grid-cols-5">
        {[
          ["Issued", totals.issued, "text-gray-900"],
          ["Received", totals.received, "text-gray-900"],
          ["Digitalised", totals.digitalised, "text-gray-900"],
          ["Verified", totals.verified, "text-(--dc-primary)"],
          ["Outstanding", totals.outstanding, totals.outstanding > 0 ? "text-amber-700" : "text-gray-900"],
        ].map(([label, v, tone]) => (
          <div key={label} className="rounded-lg border border-gray-200 px-3 py-2">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-lg font-semibold ${tone}`}>{NUMBER.format(v)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Partner, reference or sales rep"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-primary) focus:outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={outstandingOnly}
            onChange={(e) => setOutstandingOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-(--dc-primary) focus:ring-(--dc-primary)"
          />
          Still outstanding
        </label>
        {(search || outstandingOnly) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setOutstandingOnly(false);
            }}
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

      {loading ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading partner records...
        </p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">No transfers match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-(--dc-surface-muted) text-xs font-semibold uppercase tracking-wide text-gray-500">
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"}`}
                    style={{ width: c.width }}
                  >
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-left">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.transfer_id} className="border-b border-gray-100 hover:bg-(--dc-primary-soft)/40">
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""} ${
                        c.key === "outstanding_count" && row.outstanding_count > 0
                          ? "font-medium text-amber-700"
                          : "text-gray-700"
                      }`}
                    >
                      {cell(row, c.key)}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <FunnelBar row={row} />
                    {row.received_count > row.digitalised_count && (
                      <span className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
                        <TriangleAlert className="h-3 w-3" />
                        {NUMBER.format(row.received_count - row.digitalised_count)} received, not yet typed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

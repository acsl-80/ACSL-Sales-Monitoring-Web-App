import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import ExportButton from "../../components/ExportButton";
import PartnerDetail from "./PartnerDetail";
import { plural } from "../../lib/plural";
import PeriodFilter from "../../components/PeriodFilter";
import { usePeriod } from "../../lib/usePeriod";
import {
  Handshake, Loader2, AlertTriangle, Search, X, Clock, TriangleAlert,
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
    <span
      className="flex h-4 w-full overflow-hidden rounded-full border border-gray-200 bg-gray-100"
      aria-hidden="true"
    >
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

/**
 * What the export offers, and what each column is called in the file.
 *
 * Named here rather than dumping the raw keys, because the file is read by
 * someone reconciling against a spreadsheet who has never seen this schema and
 * should not have to guess what received_is_logged means.
 */
const EXPORT_COLUMNS = [
  { key: "partner_name", label: "Partner" },
  { key: "transaction_id", label: "Transfer reference" },
  { key: "sales_rep", label: "Sales rep" },
  { key: "transfer_state", label: "State" },
  { key: "transfer_branch", label: "Branch" },
  { key: "sales_date", label: "Transfer date" },
  { key: "issued_count", label: "Issued" },
  { key: "received_count", label: "Received" },
  { key: "received_is_logged", label: "Received was logged" },
  { key: "digitalised_count", label: "Digitalised" },
  { key: "verified_count", label: "Verified" },
  { key: "unverified_count", label: "Unverified" },
  { key: "unreachable_count", label: "Unreachable" },
  { key: "unresolved_count", label: "Yet to be resolved" },
  { key: "outstanding_count", label: "Outstanding" },
  { key: "partner_id", label: "Partner id" },
];

export default function PartnerRecords() {
  const [rows, setRows] = useState([]);
  /**
   * A partner named in a link is open on arrival.
   *
   * The stove record links here by id, and landing on the full list with the
   * partner merely somewhere in it would make the link a suggestion rather
   * than a destination.
   */
  const linked = useSearch({ from: "/data-center/partner-records" });
  const [openPartner, setOpenPartner] = useState(() =>
    linked.organizationId
      ? { organization_id: linked.organizationId, partner_name: linked.partnerName ?? "" }
      : null,
  );
  const [computedAt, setComputedAt] = useState(null);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  /**
   * Partner Records had no date filter at all, which made it the one surface
   * that could not be asked the same question as the rest: a scorecard over
   * all time beside a record list over this year reads as a contradiction
   * rather than as two different questions.
   */
  const { period, setPeriod, resolved, earliest } = usePeriod("/data-center/partner-records");

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
          ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
          ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
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
  }, [applied, outstandingOnly, resolved.dateFrom, resolved.dateTo]);

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


  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <Handshake className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Partner Records</span>
        <span className="text-sm text-gray-500">
          {loading ? "loading..." : `${plural(rows.length, "transfer")}`}
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
        <div className="ml-auto">
          <ExportButton
            columns={EXPORT_COLUMNS}
            rows={() => rows}
            filename="partner-records.csv"
            disabled={rows.length === 0}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-4 py-3 sm:grid-cols-5">
        {[
          ["Issued", totals.issued, "text-gray-900"],
          ["Received", totals.received, "text-gray-900"],
          ["Digitalised", totals.digitalised, "text-gray-900"],
          ["Verified", totals.verified, "text-(--dc-accent)"],
          ["Outstanding", totals.outstanding, totals.outstanding > 0 ? "text-amber-700" : "text-gray-900"],
        ].map(([label, v, tone]) => (
          <div
            key={label}
            className="rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/30 px-3 py-2.5"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>
              {NUMBER.format(v)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[240px] sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Partner, reference or sales rep"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </div>
        <PeriodFilter
          period={period}
          onChange={setPeriod}
          earliest={earliest}
          area="partner-records"
          noun="consignments"
        />
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
              <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"} ${
                      i === 0 ? "sticky left-0 z-10 bg-(--dc-accent-soft)" : ""
                    }`}
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
                <tr
                  key={row.transfer_id}
                  onClick={() => setOpenPartner(row)}
                  // The whole row, because the question "which 15 of those 200
                  // are verified" was unanswerable from this table: it could
                  // say 200 and 15 and offered no way to ask which.
                  className="group cursor-pointer border-b border-gray-100"
                >
                  {COLUMNS.map((c, i) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 transition ${
                        c.align === "right" ? "text-right tabular-nums" : ""
                      } ${
                        i === 0
                          ? "sticky left-0 z-10 bg-white font-medium group-hover:bg-(--dc-accent-soft)"
                          : "group-hover:bg-(--dc-accent-soft)/40"
                      } ${
                        c.key === "outstanding_count" && row.outstanding_count > 0
                          ? "font-medium text-amber-700"
                          : "text-gray-700"
                      }`}
                    >
                      {cell(row, c.key)}
                    </td>
                  ))}
                  <td className="px-3 py-2 transition group-hover:bg-(--dc-accent-soft)/40">
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
      {openPartner && (
        <PartnerDetail
          organizationId={openPartner.organization_id}
          partnerName={openPartner.partner_name}
          onClose={() => setOpenPartner(null)}
        />
      )}
    </div>
  );
}

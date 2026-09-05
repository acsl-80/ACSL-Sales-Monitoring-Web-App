import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, ArrowLeft } from "lucide-react";
import { dataCenterStock, DataCenterError } from "../../lib/client";
import ExportButton from "../../components/ExportButton";
import { plural } from "../../lib/plural";

/**
 * The stoves behind a bar on the ageing chart.
 *
 * This exists because the ageing chart needed somewhere to go and there was
 * nowhere. `records`, `call_queue` and every other list in the module is built
 * on `v_sold_stoves`, which begins `from public.sales` - so a stove that has
 * not been sold has no row in any of them. It is a different population, not a
 * narrower one, which is why this is a new action rather than a new filter.
 *
 * The band filter is a CODE, resolved on the server against the same
 * `age_bands` function compute bucketed with. Repeating "thirty days" here
 * would be a second definition of critical that agrees with the chart until
 * somebody edits one of them.
 *
 * Keyset paging, never OFFSET. The cursor is a date and a stove id, and the
 * date travels as text: it is a `date` column so the microsecond truncation
 * that bites timestamptz cursors does not apply here, but the habit is what
 * stops it applying the day somebody re-cuts this on transfer_date.
 */
export default function StockList({ organizationId, ageBucket, state, label }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filters = { organizationId, ageBucket, state };

  const load = useCallback(
    async (next) => {
      setLoading(true);
      setError(null);
      try {
        const page = await dataCenterStock.list(filters, next ?? null, 100);
        setRows((prev) => (next ? [...prev, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (err) {
        setError(
          err instanceof DataCenterError ? err.message : "Could not load the stock list.",
        );
      } finally {
        setLoading(false);
      }
    },
    [organizationId, ageBucket, state],
  );

  useEffect(() => {
    setRows([]);
    setCursor(null);
    load(null);
  }, [load]);

  /*
   * The band is named by the URL, not by a second request.
   *
   * This page is gated on records.view - somebody chasing a consignment needs
   * it whether or not they may read the analysis that sent them here - while
   * the analysis endpoint needs analysis.view. Asking it for a label would
   * have 403d for exactly the users this page is widest for, and the drill
   * already carries the label it drew.
   */
  const narrowedTo = label ?? [state, ageBucket].filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      <Link
        to="/data-center/analysis"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-(--dc-accent) hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Analysis
      </Link>

      {(label || ageBucket || state) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border-l-4 border-l-(--dc-accent) bg-(--dc-accent-soft) px-3 py-2">
          <span className="text-sm text-gray-800">
            Narrowed from Analysis to{" "}
            <span className="font-semibold">
              {narrowedTo}
            </span>
          </span>
          <Link
            to="/data-center/stock"
            search={{}}
            className="text-xs font-semibold text-(--dc-accent) hover:underline"
          >
            Show everything
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {loading && rows.length === 0 ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading
            </span>
          ) : (
            <>
              {plural(rows.length, "stove")} loaded
              {hasMore ? ", more available" : ""}
            </>
          )}
        </p>
        <ExportButton
          columns={[
            { key: "stove_id", label: "Serial number" },
            { key: "partner_name", label: "Partner" },
            { key: "transaction_id", label: "Transfer reference" },
            { key: "state", label: "State" },
            { key: "transferred_on", label: "Transferred" },
            { key: "days", label: "Days in stock" },
            { key: "factory", label: "Factory" },
          ]}
          rows={() => rows}
          filename="unsold-stock.csv"
          label="Export stock"
          disabled={rows.length === 0}
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-(--dc-accent-soft)">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                Serial number
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                Partner
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                Transfer
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                State
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                Transferred
              </th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-gray-700">
                Days in stock
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stove_id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  {/* Straight into the stove's own record, which is where
                      somebody chasing a unit actually needs to arrive. */}
                  <Link
                    to="/data-center/stove/$stoveId"
                    params={{ stoveId: r.stove_id }}
                    className="font-medium text-(--dc-accent) hover:underline"
                  >
                    {r.stove_id}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-800">{r.partner_name}</td>
                <td className="px-3 py-2 text-gray-600">{r.transaction_id ?? "-"}</td>
                <td className="px-3 py-2 text-gray-600">{r.state ?? "-"}</td>
                <td className="px-3 py-2 text-gray-600">{r.transferred_on ?? "-"}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {r.days}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                  No unsold stock matches this. That is a good answer as often as it is
                  an empty one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => load(cursor)}
          disabled={loading}
          className="rounded-md border border-(--dc-accent) px-3 py-1.5 text-sm font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-50"
        >
          {loading ? "Loading" : "Load more"}
        </button>
      )}
    </div>
  );
}

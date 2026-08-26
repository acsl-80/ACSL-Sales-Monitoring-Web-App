import { Link } from "@tanstack/react-router";
import { heatFor, heatTextFor } from "../lib/palette";

/**
 * A cross-tab as a real table, not a chart.
 *
 * recharts has no heatmap mark. The usual workaround is a ScatterChart of
 * square shapes with a Cell per point, which gives cells that do not tile,
 * quasi-numeric axes, and fragile hit-testing across a grid this size. A
 * treemap is not a cross-tab.
 *
 * So it is drawn as a `<table>`, and every property that matters comes free:
 * keyboard navigation, a screen reader that can say "Kano, 30-59 days, 199",
 * cells that are already anchors so drill-through needs no click handler,
 * printing, and text selection. An SVG grid has none of those.
 *
 * It is also the one chart shape an e2e test can verify arithmetically: the
 * spec sums each row's cells and asserts they equal the row total, and sums
 * the row totals and asserts they equal the grand total. You cannot read a
 * recharts SVG that way, which is why the reconciliation the whole module
 * rests on is checked here rather than asserted in a comment.
 *
 * Margins are shown deliberately. A cross-tab without them makes the reader
 * add a row of twelve numbers in their head to find out whether a partner is
 * large or merely spread out.
 */
export default function Heatmap({ table, drillFor, maxRows = 20, unit = "units" }) {
  const shown = table.rows.slice(0, maxRows);
  const hidden = table.rows.length - shown.length;

  // The ramp is per cell against the largest single cell, not against the row
  // total. Against the row total every row's darkest cell looks the same and
  // the map stops comparing rows to each other, which is its only job.
  let max = 0;
  for (const r of shown) {
    for (const c of table.cols) max = Math.max(max, table.at(r.key, c.key));
  }

  /*
   * Margins are summed over the rows ACTUALLY DRAWN, not over the whole table.
   *
   * `table.colTotal` and `table.grand` cover every row including the ones cut
   * by maxRows, so using them would print a footer that does not add up to the
   * body above it. A reader checking one column by eye would find the table
   * lying to them, and the e2e spec that sums the cells would fail against
   * correct data.
   *
   * The rows beyond the cut are not lost - they are in the export, and the
   * line below the table says how many.
   */
  const colTotal = (colKey) => shown.reduce((n, r) => n + table.at(r.key, colKey), 0);
  const shownTotal = shown.reduce((n, r) => n + r.total, 0);

  const target = (row, col) =>
    drillFor?.({ row, col, value: table.at(row.key, col?.key) }) ?? null;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-xs font-semibold text-gray-600"
              >
                Group
              </th>
              {table.cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-semibold text-gray-600"
                >
                  {c.label}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right text-xs font-bold text-gray-900">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-gray-100">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[14rem] truncate bg-white px-2 py-1.5 text-left text-xs font-medium text-gray-900"
                  title={r.label}
                >
                  {r.label}
                </th>
                {table.cols.map((c) => {
                  const value = table.at(r.key, c.key);
                  const to = value ? target(r, c) : null;
                  return (
                    <td
                      key={c.key}
                      className="px-1 py-1 text-right tabular-nums"
                      style={{
                        background: heatFor(value, max),
                        color: heatTextFor(value, max),
                      }}
                    >
                      {to ? (
                        <Link
                          to={to.to}
                          search={to.search}
                          className="block rounded px-1 py-0.5 underline-offset-2 hover:underline focus:outline-2 focus:outline-offset-1 focus:outline-(--dc-accent)"
                          aria-label={`${r.label}, ${c.label}: ${value} ${unit}`}
                        >
                          {value || ""}
                        </Link>
                      ) : (
                        <span className="block px-1 py-0.5">{value || ""}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right text-xs font-bold tabular-nums text-gray-900">
                  {r.total}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-xs font-bold text-gray-900"
              >
                Total
              </th>
              {table.cols.map((c) => (
                <td
                  key={c.key}
                  className="px-2 py-2 text-right text-xs font-bold tabular-nums text-gray-900"
                >
                  {colTotal(c.key)}
                </td>
              ))}
              <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-gray-900">
                {shownTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {hidden > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {hidden} more rows are in the export. The totals row adds up only the
          rows shown here, so it reconciles with what is on screen rather than
          with a number you cannot see.
        </p>
      )}
    </>
  );
}

import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import ExportButton from "../../../components/ExportButton";

/**
 * Nothing on the Analysis page draws without this frame, and the frame is why.
 *
 * CLAUDE.md requires that every scorecard and every table it drills into
 * exports CSV, and that drill-through is a URL rather than component state.
 * ROADMAP.md separately records "no drill-down from a chart" as a standing
 * gap: the dashboard bars shipped twice without one. A chart showing a number
 * nobody can open and nobody can take away is a picture of an answer.
 *
 * So the three are one component's contract rather than three things each
 * chart is trusted to remember:
 *
 *   render  children receive the pivoted table, already read out of the flat
 *           dimension by lib/readAnalysis
 *   drill   drillFor(cell) -> {to, search} or null. Null draws plain, exactly
 *           as the dashboard's `linkFor` does: an affordance that leads
 *           nowhere is worse than no affordance
 *   export  through the same ExportButton the scorecards use, over the same
 *           rows the chart drew, so the file and the picture cannot disagree
 *
 * THE HIDDEN LIST IS NOT DECORATION
 *
 * An SVG `<Bar onClick>` is not focusable and has no accessible name, so a
 * chart whose only route to the data is a click on a rectangle is unreachable
 * by keyboard and unreadable by a screen reader. The sr-only list carries the
 * same rows as real links.
 *
 * It also makes the e2e specs writable by role rather than by clicking SVG
 * paths - which matters, because the bench spec's helper raced a shared
 * selector, returned false, and skipped four tests over a feature nobody had
 * checked. A test that can name what it clicks does not do that.
 */
export default function ChartFrame({
  title,
  subtitle,
  table,
  drillFor,
  exportColumns,
  exportName,
  /**
   * Override the rows when the chart draws something the pivot cannot express
   * - a derived rate, or a series over months rather than a cross-tab. Still a
   * thunk, and still the numbers that were drawn: the point of routing every
   * export through here is that the file and the picture cannot disagree, and
   * an override that fetched its own data would give that up.
   */
  exportRows: exportRowsOverride,
  footnote,
  emptyText = "Nothing to show for this period.",
  children,
}) {
  /*
   * Loud in development, silent in production.
   *
   * "We will add the drill later" is exactly how the dashboard bars shipped
   * twice without one, so a chart that offers neither a way in nor a way out
   * fails at the point somebody writes it rather than at the point somebody
   * needs it.
   */
  if (import.meta.env.DEV && !drillFor && !exportColumns) {
    throw new Error(
      `ChartFrame "${title}" has neither drillFor nor exportColumns. ` +
        "A chart nobody can open and nobody can export is a picture of an answer.",
    );
  }

  // Tidy rather than wide: one row per cell, so a cross-tab opens straight
  // into a pivot table instead of needing to be unpivoted first.
  const exportRows = useMemo(
    () => () => {
      if (exportRowsOverride) return exportRowsOverride();
      if (!table) return [];
      if (!table.cols.length) {
        return table.rows.map((r) => ({ row: r.label, column: "", value: r.total }));
      }
      return table.rows.flatMap((r) =>
        table.cols.map((c) => ({
          row: r.label,
          column: c.label,
          value: table.at(r.key, c.key),
        })),
      );
    },
    [table, exportRowsOverride],
  );

  const links = useMemo(() => {
    if (!table || !drillFor) return [];
    const out = [];
    for (const r of table.rows) {
      if (table.cols.length) {
        for (const c of table.cols) {
          if (!table.at(r.key, c.key)) continue;
          const target = drillFor({ row: r, col: c, value: table.at(r.key, c.key) });
          if (target) out.push({ ...target, name: `${r.label}, ${c.label}` });
        }
      } else {
        const target = drillFor({ row: r, col: null, value: r.total });
        if (target) out.push({ ...target, name: r.label });
      }
    }
    return out;
  }, [table, drillFor]);

  const empty = !table || table.isEmpty;

  return (
    <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-gray-600">{subtitle}</p>}
        </div>
        {exportColumns && (
          <ExportButton
            columns={exportColumns}
            rows={exportRows}
            filename={exportName}
            label={`Export ${title}`}
            disabled={empty}
          />
        )}
      </header>

      <div className="px-4 py-4">
        {empty ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
            {emptyText}
          </p>
        ) : (
          children({ table, drillFor })
        )}
      </div>

      {footnote && (
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">{footnote}</p>
      )}

      {/*
        The same cells as links, for a keyboard and for a screen reader. Not an
        alternative view of the data: the identical set, named.
      */}
      {links.length > 0 && (
        <ul className="sr-only">
          {links.map((l, i) => (
            <li key={`${l.name}-${i}`}>
              <Link to={l.to} search={l.search}>
                {title}: {l.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The three columns every chart exports. Kept here so they cannot drift. */
export const CELL_COLUMNS = [
  { key: "row", label: "Group" },
  { key: "column", label: "Band" },
  { key: "value", label: "Value" },
];

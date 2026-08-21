import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import ExportButton from "../../components/ExportButton";
import Pagination from "../../components/Pagination";
import { usePaged } from "../../lib/usePaged";
import { plural } from "../../lib/plural";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * One scorecard, parameterised by dimension. There are five on the dashboard
 * and this is the only implementation, which is the rule from CLAUDE.md: five
 * copies of the same six columns are five chances for the same number to
 * disagree with itself.
 *
 * Closed by default, and that is the change that made the dashboard readable.
 * Five tables of every partner, every state, every rep, every agent and every
 * manager, all open at once, is a page nobody scrolls to the bottom of; at 278
 * partners it is not a dashboard at all. The header carries the row count, so
 * a closed card still answers "how many" without being opened.
 *
 * Every status cell is a link into the call centre queue, filtered to exactly
 * what the number counted. Drill-through is a URL, never component state, so
 * the browser's back button restores the dashboard without anything being
 * written to make it do that.
 */

const NUMBER = new Intl.NumberFormat("en-NG");

/**
 * The four status columns and the filter each maps to. The mapping mirrors
 * OUTCOME_GROUPS on the server, where each group is defined as the same
 * outcomes the metric counted: a cell saying 12 and the table behind it
 * showing 12 rows is by construction, not coincidence.
 */
const STATUS_COLUMNS = [
  { metric: "verified", label: "Verified", tone: "text-(--dc-accent)" },
  { metric: "unverified", label: "Unverified", tone: "text-amber-700" },
  { metric: "unreachable", label: "Unreachable", tone: "text-orange-700" },
  { metric: "unresolved", label: "Yet to be resolved", tone: "text-gray-600" },
];

const VOLUME_COLUMNS = [
  { metric: "issued", label: "Issued" },
  { metric: "received", label: "Received" },
  { metric: "digitalised", label: "Digitalised" },
];

/** Which queue filter a dimension's key becomes. Mirrors the server's filters. */
const DRILL_PARAM = {
  partner: "organizationId",
  location: "partnerState",
  sales_rep: "transferSalesRep",
  call_agent: "assignedAgent",
  manager: "agentManager",
};

/**
 * Reads one dimension's rows out of the flat metric list.
 *
 * Exported because the dashboard's export-everything picker needs the same
 * rows this table draws, and building them twice is how the file somebody
 * downloads stops matching the table they were looking at.
 */
export function scorecardRows(metrics, by) {
  const groups = new Map();
  for (const m of metrics) {
    if (!m.metric_key?.startsWith("scorecard.")) continue;
    if (m.dimension?.by !== by) continue;
    const key = m.dimension.key;
    if (!groups.has(key)) groups.set(key, { key, label: m.dimension.label ?? key });
    groups.get(key)[m.metric_key.slice("scorecard.".length)] = Number(m.value_num ?? 0);
  }
  return [...groups.values()].sort((a, b) => (b.issued ?? 0) - (a.issued ?? 0));
}

/** The columns any scorecard export offers, in the order the table shows them. */
export const SCORECARD_EXPORT_COLUMNS = [
  { key: "label", label: "Name" },
  ...VOLUME_COLUMNS.map((c) => ({ key: c.metric, label: c.label })),
  ...STATUS_COLUMNS.map((c) => ({ key: c.metric, label: c.label })),
];

export default function Scorecard({ title, by, metrics, hint, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = useMemo(() => scorecardRows(metrics, by), [metrics, by]);
  const paged = usePaged(rows, 10);

  const drillSearch = (row, status) => ({
    [DRILL_PARAM[by]]: row.key,
    ...(status ? { status } : {}),
    from: by,
    label: row.label,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-(--dc-accent)" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-(--dc-accent)" />
          )}
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {/* The count on the header is why a closed card is still useful. */}
          <span className="shrink-0 rounded-full bg-(--dc-accent-soft) px-2 py-0.5 text-xs font-medium tabular-nums text-(--dc-accent-strong)">
            {plural(rows.length, "row")}
          </span>
          {hint && <span className="hidden text-xs text-gray-500 sm:inline">{hint}</span>}
        </button>
        <ExportButton
          columns={SCORECARD_EXPORT_COLUMNS}
          rows={() => rows}
          filename={`scorecard-${by}.csv`}
          label={`Export ${title}`}
          disabled={rows.length === 0}
        />
      </div>

      {open &&
        (rows.length === 0 ? (
          <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-4 text-sm text-gray-500">
            Nothing to score yet. Numbers appear after the next computation run.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] text-sm">
                <thead>
                  <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-(--dc-accent-soft) px-3 py-2 text-left"
                    >
                      {title}
                    </th>
                    {[...VOLUME_COLUMNS, ...STATUS_COLUMNS].map((c) => (
                      <th key={c.metric} scope="col" className="px-3 py-2 text-right">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.slice.map((row) => (
                    <tr key={row.key} className="group border-b border-gray-100">
                      <td className="sticky left-0 z-10 max-w-[220px] truncate bg-white px-3 py-2 font-medium text-gray-900 group-hover:bg-(--dc-accent-soft)">
                        <Link
                          to="/data-center/call-centre"
                          search={drillSearch(row, null)}
                          className="underline-offset-2 hover:underline"
                        >
                          {row.label}
                        </Link>
                      </td>
                      {VOLUME_COLUMNS.map((c) => (
                        <td
                          key={c.metric}
                          className="px-3 py-2 text-right tabular-nums text-gray-700 transition group-hover:bg-(--dc-accent-soft)/40"
                        >
                          {NUMBER.format(row[c.metric] ?? 0)}
                        </td>
                      ))}
                      {STATUS_COLUMNS.map((c) => (
                        <td
                          key={c.metric}
                          className="px-3 py-2 text-right tabular-nums transition group-hover:bg-(--dc-accent-soft)/40"
                        >
                          <Link
                            to="/data-center/call-centre"
                            search={drillSearch(row, c.metric)}
                            className={`rounded px-1.5 py-0.5 font-medium underline-offset-2 transition hover:bg-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--dc-accent) ${c.tone}`}
                            aria-label={`${row.label}: ${NUMBER.format(row[c.metric] ?? 0)} ${c.label.toLowerCase()}`}
                          >
                            {NUMBER.format(row[c.metric] ?? 0)}
                          </Link>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              onPage={paged.setPage}
              onPageSize={paged.setPageSize}
              noun="row"
            />
          </>
        ))}
    </div>
  );
}

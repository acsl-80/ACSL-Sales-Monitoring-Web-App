import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { toCsv, downloadCsv } from "../../lib/export";
import { Download } from "lucide-react";

/**
 * One scorecard, parameterised by dimension. There are five on the dashboard
 * and this is the only implementation, which is the rule from CLAUDE.md: five
 * copies of the same six columns are five chances for the same number to
 * disagree with itself.
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

export default function Scorecard({ title, by, metrics, hint }) {
  const rows = useMemo(() => {
    const groups = new Map();
    for (const m of metrics) {
      if (!m.metric_key?.startsWith("scorecard.")) continue;
      if (m.dimension?.by !== by) continue;
      const key = m.dimension.key;
      if (!groups.has(key)) {
        groups.set(key, { key, label: m.dimension.label ?? key });
      }
      groups.get(key)[m.metric_key.slice("scorecard.".length)] = Number(m.value_num ?? 0);
    }
    return [...groups.values()].sort((a, b) => (b.issued ?? 0) - (a.issued ?? 0));
  }, [metrics, by]);

  const exportCsv = () => {
    downloadCsv(
      `scorecard-${by}.csv`,
      toCsv(rows, [
        "label", "issued", "received", "digitalised",
        "verified", "unverified", "unreachable", "unresolved",
      ]),
    );
  };

  const drillSearch = (row, status) => ({
    [DRILL_PARAM[by]]: row.key,
    ...(status ? { status } : {}),
    from: by,
    label: row.label,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-4 text-sm text-gray-500">
          Nothing to score yet. Numbers appear after the next computation run.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
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
              {rows.map((row) => (
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
      )}
    </div>
  );
}

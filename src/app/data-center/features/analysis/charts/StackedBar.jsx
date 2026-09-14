import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { fillFor } from "../lib/palette";

/**
 * One bar per group, split by band.
 *
 * Horizontal because the groups are partner and state names. Vertical bars
 * with "Kano State Renewable Energy Partnership" underneath them either rotate
 * the label to 45 degrees or truncate it, and both make somebody hover to find
 * out which partner they are looking at.
 *
 * Absolute counts, never normalised to 100%. A partner with four units aged
 * past ninety days and a partner with four hundred look identical on a
 * percentage axis, and the second one is the entire reason for the chart.
 *
 * Sorted biggest first and capped, with the remainder stated rather than
 * dropped: a chart that quietly shows the top twelve of forty reads as the
 * whole population.
 */
export default function StackedBar({
  table,
  drillFor,
  severityFor,
  colorFor,
  maxRows = 12,
  unit = "units",
}) {
  const navigate = useNavigate();

  const shown = table.rows.slice(0, maxRows);
  const hidden = table.rows.length - shown.length;
  const hiddenUnits = table.rows.slice(maxRows).reduce((n, r) => n + r.total, 0);

  const data = useMemo(
    () =>
      shown.map((r) => {
        const row = { name: r.label, __key: r.key };
        for (const c of table.cols) row[c.key] = table.at(r.key, c.key);
        return row;
      }),
    [shown, table],
  );

  const go = (rowKey, col) => {
    if (!drillFor) return;
    const row = table.rows.find((r) => r.key === rowKey);
    if (!row) return;
    const target = drillFor({ row, col, value: table.at(rowKey, col?.key) });
    if (target) navigate({ to: target.to, search: target.search });
  };

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 34 + 48)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid horizontal={false} stroke="#f1f1f1" />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fontSize: 11, fill: "#374151" }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            formatter={(value, name) => [`${value} ${unit}`, name]}
          />
          {table.cols.map((c) => (
            <Bar
              key={c.key}
              dataKey={c.key}
              name={c.label}
              stackId="a"
              fill={colorFor ? colorFor(c.key) : fillFor(severityFor?.(c.key))}
              cursor={drillFor ? "pointer" : undefined}
              onClick={(d) => go(d?.payload?.__key ?? d?.__key, c)}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* The legend is written out rather than left to recharts so the band
          order matches the stack order and the severity reads as a word. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {table.cols.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: colorFor ? colorFor(c.key) : fillFor(severityFor?.(c.key)) }}
            />
            {c.label}
            <span className="font-semibold text-gray-900">{table.colTotal(c.key)}</span>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Showing the {maxRows} largest. {hidden} more hold {hiddenUnits} {unit} between
          them, and are in the export.
        </p>
      )}
    </>
  );
}

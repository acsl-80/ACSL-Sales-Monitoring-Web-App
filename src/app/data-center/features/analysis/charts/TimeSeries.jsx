import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { fillFor } from "../lib/palette";
import { monthLabel } from "../lib/readAnalysis";

/**
 * One metric over the months in range.
 *
 * This is the chart the month grain was built for: because every metric is
 * filed under a month, a quarter, a half, a year and one year against another
 * are all the same data at different bounds, and nothing had to be precomputed
 * per period to make it so.
 *
 * Stacked areas rather than lines when the buckets are parts of a whole, which
 * they always are here - bands of one population. Stacked, the top edge is the
 * total and the reader gets both facts from one shape; as separate lines they
 * would have to add five of them by eye to see whether the pile is growing.
 *
 * Zero months are drawn as zero, not skipped. `trend()` fills them, because a
 * line that jumps a quiet month draws a straight segment across it and reads
 * as steady trade through a period when nothing happened.
 */
export default function TimeSeries({
  data,
  buckets,
  severityFor,
  colorFor,
  /**
   * Stack only when the bands are PARTS of one population.
   *
   * A funnel is not. Its stages are nested subsets - every verified record is
   * also a called record and a sold one - so stacking them draws a total that
   * counts the same record up to five times, and the top edge of the chart
   * becomes a number that describes nothing. Bands of one population (age,
   * days-to-sell) stack correctly and should.
   */
  stacked = true,
  unit = "units",
  height = 220,
}) {
  if (!data?.length) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#f1f1f1" vertical={false} />
        <XAxis
          dataKey="period"
          tickFormatter={monthLabel}
          tick={{ fontSize: 11, fill: "#6b7280" }}
          minTickGap={16}
        />
        <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} width={40} />
        <Tooltip
          labelFormatter={monthLabel}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
          formatter={(value, name) => [`${value} ${unit}`, name]}
        />
        {buckets.map((b) => (
          <Area
            key={b.key}
            type="monotone"
            dataKey={b.key}
            name={b.label}
            stackId={stacked ? "a" : undefined}
            stroke={colorFor ? colorFor(b.key) : fillFor(severityFor?.(b.key))}
            fill={colorFor ? colorFor(b.key) : fillFor(severityFor?.(b.key))}
            fillOpacity={stacked ? 0.75 : 0.12}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

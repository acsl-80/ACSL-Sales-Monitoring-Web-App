import { useMemo } from "react";
import ChartFrame, { CELL_COLUMNS } from "../charts/ChartFrame";
import FunnelBars from "../charts/FunnelBars";
import StackedBar from "../charts/StackedBar";
import Heatmap from "../charts/Heatmap";
import TimeSeries from "../charts/TimeSeries";
import { xtab, trend } from "../lib/readAnalysis";
import { ramp } from "../lib/palette";
import { funnelDrill, leakDrill, unfilterableReasons } from "../lib/drill";

/**
 * Creditable yield: how much of what was sold is worth anything.
 *
 * Verified is not the finish line. A record also has to be complete on the
 * module's own definition, have its stove ID confirmed, not be a second Save80
 * in a household already counted, not be waiting on a correction, and not
 * share a phone number with another sale nobody has confirmed. Anything short
 * of all of that is a record the project cannot use, however green it looks in
 * the call centre.
 *
 * The leak decomposition is the half anybody acts on. A partner losing 18% to
 * missing addresses and a partner losing 18% to dead phones need two different
 * phone calls, and a single yield percentage hides which one you are in. Every
 * non-creditable sale is charged to exactly one reason - the first gate it
 * failed - so the reasons add up to sold minus creditable rather than
 * overlapping into a word cloud.
 */
export default function YieldBoard({ data }) {
  const funnel = useMemo(() => xtab(data.totals, "analysis.yield_funnel", "partner"), [data]);
  const leak = useMemo(() => xtab(data.totals, "analysis.yield_leak", "partner"), [data]);
  const overTime = useMemo(() => trend(data.series, "analysis.yield_funnel", "partner"), [data]);

  // The headline chain: each stage summed across every partner in range.
  const stages = useMemo(
    () => funnel.cols.map((c) => ({ key: c.key, label: c.label, value: c.total })),
    [funnel],
  );

  const leakColour = useMemo(() => {
    const index = new Map(leak.cols.map((c, i) => [c.key, i]));
    return (key) => ramp(index.get(key) ?? 0, Math.max(1, leak.cols.length));
  }, [leak]);

  const stageColour = useMemo(() => {
    const index = new Map(funnel.cols.map((c, i) => [c.key, i]));
    return (key) => ramp(index.get(key) ?? 0, Math.max(1, funnel.cols.length));
  }, [funnel]);

  const unfilterable = unfilterableReasons(leak.cols);

  return (
    <div className="space-y-4">
      <ChartFrame
        title="Creditable yield"
        subtitle="Every gate a sale has to pass before the data behind it is usable."
        table={funnel}
        exportColumns={[
          { key: "stage", label: "Stage" },
          { key: "records", label: "Records" },
          { key: "share", label: "% of sold" },
        ]}
        exportRows={() => {
          const first = stages[0]?.value ?? 0;
          return stages.map((s) => ({
            stage: s.label,
            records: s.value,
            share: first ? ((s.value / first) * 100).toFixed(1) : "",
          }));
        }}
        exportName="creditable-yield.csv"
        footnote="Each bar is its share of everything sold, not of the bar above it. Ninety-four per cent of the previous step reads as healthy five times running while two thirds of the records fall out of the bottom."
        emptyText="Nothing sold in this period."
      >
        {() => (
          <FunnelBars
            stages={stages}
            drillFor={(s) => funnelDrill(s, null, null)}
            unit="records"
          />
        )}
      </ChartFrame>

      <ChartFrame
        title="Yield by partner"
        subtitle="The same chain, one row per partner."
        table={funnel}
        drillFor={({ row, col }) => funnelDrill(col, row.key, row.label)}
        exportColumns={CELL_COLUMNS}
        exportName="creditable-yield-by-partner.csv"
        footnote="Read left to right: the gap between Sold and Creditable is what that partner's paperwork is costing."
        emptyText="Nothing sold in this period."
      >
        {({ table, drillFor }) => (
          <Heatmap table={table} drillFor={drillFor} unit="records" />
        )}
      </ChartFrame>

      <ChartFrame
        title="Where the yield leaks"
        subtitle="Every sale that is not creditable, charged to the first gate it failed."
        table={leak}
        drillFor={leakDrill}
        exportColumns={CELL_COLUMNS}
        exportName="yield-leaks.csv"
        footnote={
          unfilterable.length
            ? `The call queue can narrow to most of these directly. It has no filter yet for ${unfilterable.join(", ").toLowerCase()}, so those open the partner's records with the reason named rather than applied.`
            : undefined
        }
        emptyText="Every sale in this period is creditable, which is worth checking rather than celebrating."
      >
        {({ table, drillFor }) => (
          <StackedBar
            table={table}
            drillFor={drillFor}
            colorFor={leakColour}
            unit="records"
          />
        )}
      </ChartFrame>

      <ChartFrame
        title="Yield over time"
        subtitle="By the month of the sale. Not stacked: each stage contains the next."
        table={funnel}
        exportColumns={[
          { key: "period", label: "Month" },
          { key: "stage", label: "Stage" },
          { key: "records", label: "Records" },
        ]}
        exportRows={() =>
          overTime.data.flatMap((row) =>
            overTime.buckets.map((b) => ({
              period: row.period,
              stage: b.label,
              records: row[b.key] ?? 0,
            })),
          )
        }
        exportName="creditable-yield-over-time.csv"
        emptyText="Nothing to plot for this period."
      >
        {() => (
          <TimeSeries
            data={overTime.data}
            buckets={overTime.buckets}
            colorFor={stageColour}
            stacked={false}
            unit="records"
          />
        )}
      </ChartFrame>
    </div>
  );
}

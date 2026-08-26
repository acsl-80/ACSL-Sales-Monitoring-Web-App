import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import ChartFrame, { CELL_COLUMNS } from "../charts/ChartFrame";
import StackedBar from "../charts/StackedBar";
import Heatmap from "../charts/Heatmap";
import TimeSeries from "../charts/TimeSeries";
import { xtab, trend, severityOf, share } from "../lib/readAnalysis";
import { stockDrill, soldDrill } from "../lib/drill";

/**
 * Stacking: where stock is sitting, and whether it always does.
 *
 * Two questions that look like one. Ageing is about today - which units are
 * past the line right now, and who is holding them. Absorption is about
 * character: a partner who took five hundred units last week looks spotless on
 * ageing and may be reliably slow. The first tells you who to ring this week,
 * the second tells you what to say in the contract conversation.
 *
 * The population is narrow and every frame says so: stock TRANSFERRED to a
 * partner and not yet sold. Stock that never left ACSL has no transfer
 * reference and is not counted, so an empty top band means "no old stock at
 * partners", not "no old stock".
 */
export default function StockBoard({ data }) {
  const bands = data.stockBands ?? [];
  const vbands = data.velocityBands ?? [];
  const sevStock = (code) => severityOf(bands, code);
  const sevVelocity = (code) => severityOf(vbands, code);

  const byPartner = useMemo(() => xtab(data.totals, "analysis.stock_age", "partner"), [data]);
  const byState = useMemo(() => xtab(data.totals, "analysis.stock_age", "location"), [data]);
  const velocity = useMemo(() => xtab(data.totals, "analysis.velocity", "partner"), [data]);
  const absorption = useMemo(() => xtab(data.totals, "analysis.absorption", "partner"), [data]);
  const overTime = useMemo(() => trend(data.series, "analysis.stock_age", "partner"), [data]);

  // "Past the line" is whatever Settings currently grades as critical. Not a
  // number in this file: re-grading a band has to move this figure too.
  const criticalCodes = bands.filter((b) => b.severity === "critical").map((b) => b.code);

  const absorptionRows = useMemo(
    () =>
      absorption.rows
        .map((r) => {
          const eligible = absorption.at(r.key, "eligible");
          const within = absorption.at(r.key, "within");
          return { ...r, eligible, within, pct: share(within, eligible) };
        })
        .filter((r) => r.eligible > 0)
        .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)),
    [absorption],
  );

  return (
    <div className="space-y-4">
      <ChartFrame
        title="Stock at partners"
        subtitle="Transferred and not yet sold, by how long it has been sitting."
        table={byPartner}
        drillFor={({ row, col }) => stockDrill({ row, col, by: "partner" })}
        exportColumns={CELL_COLUMNS}
        exportName="stock-ageing-by-partner.csv"
        footnote={
          criticalCodes.length
            ? `Bands graded critical in Settings: ${bands
                .filter((b) => b.severity === "critical")
                .map((b) => b.label)
                .join(", ")}. Change the grading there and this chart follows.`
            : undefined
        }
        emptyText="No unsold stock at partners in this period."
      >
        {({ table, drillFor }) => (
          <StackedBar
            table={table}
            drillFor={drillFor}
            severityFor={sevStock}
            unit="stoves"
          />
        )}
      </ChartFrame>

      <ChartFrame
        title="Stock by state"
        subtitle="The same stoves, cut by where the consignment went."
        table={byState}
        drillFor={({ row, col }) => stockDrill({ row, col, by: "location" })}
        exportColumns={CELL_COLUMNS}
        exportName="stock-ageing-by-state.csv"
        footnote="Every cell is a link into the stoves behind it. Totals add up the rows shown."
        emptyText="No unsold stock at partners in this period."
      >
        {({ table, drillFor }) => (
          <Heatmap table={table} drillFor={drillFor} unit="stoves" />
        )}
      </ChartFrame>

      <ChartFrame
        title="Stock ageing over time"
        subtitle="Filed by the month each consignment went out."
        table={byPartner}
        exportColumns={[
          { key: "period", label: "Month" },
          { key: "band", label: "Band" },
          { key: "stoves", label: "Stoves" },
        ]}
        exportRows={() =>
          overTime.data.flatMap((row) =>
            overTime.buckets.map((b) => ({
              period: row.period,
              band: b.label,
              stoves: row[b.key] ?? 0,
            })),
          )
        }
        exportName="stock-ageing-over-time.csv"
        emptyText="Nothing to plot for this period."
      >
        {() => (
          <TimeSeries
            data={overTime.data}
            buckets={overTime.buckets}
            severityFor={sevStock}
            unit="stoves"
          />
        )}
      </ChartFrame>

      <ChartFrame
        title="Days to sell"
        subtitle="How long a stove took to move, for the stock that did move."
        table={velocity}
        drillFor={({ row }) => soldDrill({ row })}
        exportColumns={CELL_COLUMNS}
        exportName="days-to-sell.csv"
        footnote="A distribution rather than an average: one consignment forgotten for a year drags a mean somewhere no actual stove has ever been."
        emptyText="Nothing sold from stock transferred in this period."
      >
        {({ table, drillFor }) => (
          <StackedBar
            table={table}
            drillFor={drillFor}
            severityFor={sevVelocity}
            unit="stoves"
          />
        )}
      </ChartFrame>

      <ChartFrame
        title="Absorption"
        subtitle="Of the stock old enough to judge, how much sold inside the window."
        table={absorption}
        drillFor={({ row }) => stockDrill({ row, col: null, by: "partner" })}
        exportColumns={[
          { key: "partner", label: "Partner" },
          { key: "eligible", label: "Eligible units" },
          { key: "within", label: "Sold in window" },
          { key: "rate", label: "Absorption %" },
        ]}
        exportRows={() => absorptionExportRows(data)}
        exportName="absorption.csv"
        footnote="Worst first. A partner with a low rate is slow by habit rather than by circumstance, which is a different conversation from a single ageing consignment."
        emptyText="No consignment is old enough to judge in this period."
      >
        {() => (
          <ul className="space-y-1.5">
            {absorptionRows.slice(0, 12).map((r) => (
              <li key={r.key} className="flex items-center gap-3">
                <Link
                  to="/data-center/stock"
                  search={{ organizationId: r.key, label: r.label }}
                  className="w-40 shrink-0 truncate text-xs font-medium text-gray-900 underline-offset-2 hover:underline"
                  title={r.label}
                >
                  {r.label}
                </Link>
                <span className="h-4 flex-1 overflow-hidden rounded bg-gray-100">
                  <span
                    className="block h-full bg-(--dc-accent)"
                    style={{ width: `${Math.max(1, r.pct ?? 0)}%` }}
                  />
                </span>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-600">
                  <span className="font-bold text-gray-900">
                    {(r.pct ?? 0).toFixed(0)}%
                  </span>{" "}
                  of {r.eligible}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ChartFrame>
    </div>
  );
}

/** The absorption export needs the derived rate, which the table does not hold. */
export function absorptionExportRows(data) {
  const t = xtab(data.totals, "analysis.absorption", "partner");
  return t.rows.map((r) => {
    const eligible = t.at(r.key, "eligible");
    const within = t.at(r.key, "within");
    return {
      partner: r.label,
      eligible,
      within,
      rate: eligible ? ((within / eligible) * 100).toFixed(1) : "",
    };
  });
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, TriangleAlert, ArrowUp, ArrowDown } from "lucide-react";
import { dataCenterAnalysis, dataCenterDashboard, DataCenterError } from "../../lib/client";
import RangePicker from "./RangePicker";
import StockBoard from "./boards/StockBoard";
import YieldBoard from "./boards/YieldBoard";
import { xtab, share } from "./lib/readAnalysis";
import { previousRange, delta } from "./lib/range";

/**
 * Analysis: the module's seventh area.
 *
 * The other six collect. This one says what the collection means - which
 * partner is sitting on stock, and how much of what was sold is actually worth
 * anything to a carbon project.
 *
 * NOTHING HERE IS LIVE, AND THE PAGE SAYS SO
 *
 * Every figure is as of the last computation. That is the same contract the
 * Dashboard has kept since Phase 8, and it is stated at the top rather than
 * implied, because a number with no date on it gets read as current. What is
 * live is the interaction: every chart is clickable through to the records
 * behind it and every chart exports the numbers it drew.
 *
 * WHY THE COMPARISON IS "THE RANGE BEFORE" RATHER THAN A YEAR
 *
 * Year on year, quarter on quarter and month on month are one mechanism: take
 * the range, count its months, step back that many. Building a year-on-year
 * toggle would have answered one of those three.
 */
export default function Analysis({ canRun = false }) {
  const [range, setRange] = useState({ from: null, to: null });
  const [data, setData] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async (from, to) => {
    setLoading(true);
    setError(null);
    try {
      const current = await dataCenterAnalysis.get(from, to);
      setData(current);

      /*
       * The comparison is a second read, not a second computation. Both hit
       * metric_snapshots, which the run already wrote, so this costs a query
       * over a few thousand indexed rows rather than another pass over sales.
       */
      const prior = previousRange(from, to);
      setPrevious(prior ? await dataCenterAnalysis.get(prior.from, prior.to) : null);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "Could not load the analysis.",
      );
      setData(null);
      setPrevious(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range.from, range.to);
  }, [load, range.from, range.to]);

  const recompute = async () => {
    setRunning(true);
    try {
      await dataCenterDashboard.run();
      await load(range.from, range.to);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "The computation did not run.",
      );
    } finally {
      setRunning(false);
    }
  };

  const figures = useMemo(() => {
    if (!data) return null;
    return headline(data, previous);
  }, [data, previous]);

  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the last computation
      </p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3">
        <p className="text-sm font-semibold text-red-900">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-gray-200 bg-(--dc-surface-muted) px-4 py-3">
        <RangePicker
          months={data.months}
          from={range.from}
          to={range.to}
          onChange={setRange}
          disabled={loading}
        />
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-600">
            {data.computedAt ? (
              <>
                Computed{" "}
                <span className="font-semibold text-gray-900">
                  {new Date(data.computedAt).toLocaleString()}
                </span>
              </>
            ) : (
              "Never computed"
            )}
          </p>
          {canRun && (
            <button
              type="button"
              onClick={recompute}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent) px-2.5 py-1.5 text-xs font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              {running ? "Computing" : "Recompute"}
            </button>
          )}
        </div>
      </div>

      {data.isStale && (
        <p className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          These figures are more than {data.staleAfterHours} hours old. Nothing on this
          page is live; it is as of the computation named above.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}

      {figures && <Headline figures={figures} comparing={Boolean(previous)} />}

      <section className="space-y-3">
        <h2 className="text-base font-bold text-gray-900">Stacking</h2>
        <p className="max-w-3xl text-sm text-gray-600">
          Stock transferred to a partner and not yet sold. Two different questions
          share the word: what is sitting past the line today, and whether a partner
          is slow by habit.
        </p>
        <StockBoard data={data} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-gray-900">Creditable yield</h2>
        <p className="max-w-3xl text-sm text-gray-600">
          Verified data is the only usable data, and verified is not the last gate.
          This is how much of what was sold survives all of them, and what stops the
          rest.
        </p>
        <YieldBoard data={data} />
      </section>
    </div>
  );
}

/** The four numbers worth reading before any chart. */
function headline(data, previous) {
  const read = (d) => {
    const stock = xtab(d.totals, "analysis.stock_age", "partner");
    const funnel = xtab(d.totals, "analysis.yield_funnel", "partner");
    const critical = (d.stockBands ?? [])
      .filter((b) => b.severity === "critical")
      .map((b) => b.code);
    return {
      stock: stock.grand,
      past: critical.reduce((n, c) => n + stock.colTotal(c), 0),
      sold: funnel.colTotal("sold"),
      creditable: funnel.colTotal("creditable"),
    };
  };

  const now = read(data);
  const before = previous ? read(previous) : null;

  return [
    {
      key: "past",
      label: "Stock past the line",
      value: now.past,
      hint: `of ${now.stock.toLocaleString()} still unsold with a partner`,
      change: before ? delta(now.past, before.past) : null,
      // More stock sitting past the threshold is worse, so a rise is bad here
      // and a rise in creditable records is good. Colouring both green for
      // "up" would be a chart that congratulates you on the problem.
      goodWhen: "down",
    },
    {
      key: "creditable",
      label: "Creditable records",
      value: now.creditable,
      hint: `of ${now.sold.toLocaleString()} sold`,
      change: before ? delta(now.creditable, before.creditable) : null,
      goodWhen: "up",
    },
    {
      key: "rate",
      label: "Creditable rate",
      value: share(now.creditable, now.sold),
      suffix: "%",
      hint: "share of sales that clear every gate",
      change: before
        ? delta(share(now.creditable, now.sold), share(before.creditable, before.sold))
        : null,
      goodWhen: "up",
    },
    {
      key: "sold",
      label: "Sold",
      value: now.sold,
      hint: "records in this period",
      change: before ? delta(now.sold, before.sold) : null,
      goodWhen: "up",
    },
  ];
}

function Headline({ figures, comparing }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {figures.map((f) => {
        const up = f.change != null && f.change > 0;
        const good = f.change == null ? null : (up ? f.goodWhen === "up" : f.goodWhen === "down");
        return (
          <div
            key={f.key}
            className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-xs font-medium text-gray-600">{f.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
              {f.value == null
                ? "-"
                : f.suffix === "%"
                  ? `${f.value.toFixed(1)}%`
                  : f.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{f.hint}</p>
            {comparing && (
              <p
                className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${
                  good == null ? "text-gray-400" : good ? "text-green-700" : "text-red-700"
                }`}
              >
                {f.change == null ? (
                  "no comparison"
                ) : (
                  <>
                    {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {Math.abs(f.change).toFixed(1)}% on the period before
                  </>
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

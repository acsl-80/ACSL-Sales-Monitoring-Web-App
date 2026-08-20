import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterDashboard, DataCenterError } from "../../lib/client";
import {
  BarChart3, Loader2, AlertTriangle, RefreshCw, Clock, TriangleAlert,
} from "lucide-react";

/**
 * The dashboard.
 *
 * Everything here came from a computation run. This component fetches one
 * payload and reads values out of it: no counting, no summing, nothing derived
 * from a list of sales, because there is no list of sales to derive it from.
 *
 * The charts are CSS rather than a charting library, for the same reason the
 * table is not using a virtualization library and the import is not using a
 * CSV library: taking a dependency means editing package.json and bun.lock,
 * both of which the daily contractor merge touches. Bars whose width is a
 * percentage do not need a library.
 */

const NUMBER = new Intl.NumberFormat("en-NG");

function value(metrics, key, dimension = null) {
  const found = metrics.find(
    (m) =>
      m.metric_key === key &&
      (dimension === null ||
        Object.entries(dimension).every(([k, v]) => m.dimension?.[k] === v)),
  );
  return found ? Number(found.value_num ?? 0) : 0;
}

function series(metrics, key, dimensionKey) {
  return metrics
    .filter((m) => m.metric_key === key)
    .map((m) => ({
      label: m.dimension?.[dimensionKey] ?? "Unknown",
      value: Number(m.value_num ?? 0),
    }))
    .sort((a, b) => b.value - a.value);
}

function Card({ label, value: v, hint, tone }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-gray-900"}`}>
        {typeof v === "number" ? NUMBER.format(v) : v}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const BAR_TONES = {
  fully_verified: "bg-[#4a5d0f]",
  partially_verified: "bg-amber-500",
  doubtful_verification: "bg-orange-500",
  not_verified: "bg-gray-400",
  never_called: "bg-gray-300",
  sold: "bg-[#4a5d0f]",
  available: "bg-blue-400",
};

function Bars({ title, data, subtitle, emptyText }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{emptyText ?? "Nothing to show yet."}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.map((d) => (
            <li key={d.label} className="flex items-center gap-2 text-sm">
              <span className="w-40 shrink-0 truncate text-gray-700" title={d.label}>
                {d.label.replace(/_/g, " ")}
              </span>
              <span className="h-4 min-w-0 flex-1 overflow-hidden rounded bg-gray-100">
                <span
                  className={`block h-full rounded ${BAR_TONES[d.label] ?? "bg-[#6b8016]"}`}
                  style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-gray-700">
                {NUMBER.format(d.value)}
                {total > 0 && (
                  <span className="ml-1 text-xs text-gray-400">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard({ canRun }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await dataCenterDashboard.get());
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recompute = async () => {
    setRunning(true);
    setError(null);
    try {
      const out = await dataCenterDashboard.run();
      await load();
      setError(null);
      // Worth surfacing: it is the number that justifies the whole split.
      setData((d) => (d ? { ...d, lastDuration: out.durationMs } : d));
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "The computation failed.");
    } finally {
      setRunning(false);
    }
  };

  const m = data?.metrics ?? [];

  const verification = useMemo(
    () => series(m, "verification.by_outcome", "outcome"),
    [m],
  );
  const byPartner = useMemo(() => series(m, "sales.by_partner", "partner").slice(0, 10), [m]);
  const byState = useMemo(() => series(m, "sales.by_state", "state").slice(0, 10), [m]);
  const byMonth = useMemo(
    () =>
      m
        .filter((x) => x.metric_key === "sales.by_month")
        .map((x) => ({ label: x.dimension?.month ?? "?", value: Number(x.value_num ?? 0) }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(-12),
    [m],
  );
  const stock = useMemo(() => series(m, "stock.by_status", "status"), [m]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the dashboard...
      </div>
    );
  }

  const total = value(m, "sales.total");
  const complete = value(m, "sales.complete");
  const appSays = value(m, "sales.app_says_completed");
  const disagreement = value(m, "sales.status_disagreement");
  const verified = value(m, "verification.by_outcome", { outcome: "fully_verified" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <BarChart3 className="h-4 w-4 text-[#4a5d0f]" />
        <span className="text-sm font-semibold text-gray-900">Dashboards</span>
        {data?.computedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            computed {new Date(data.computedAt).toLocaleString()}
          </span>
        ) : (
          <span className="text-xs text-gray-500">never computed</span>
        )}
        {data?.isStale && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            <TriangleAlert className="h-3 w-3" />
            {data.computedAt
              ? `older than ${data.staleAfterHours}h`
              : "no figures yet"}
          </span>
        )}
        {canRun && (
          <button
            type="button"
            disabled={running}
            onClick={recompute}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {running ? "Computing..." : "Recompute"}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}

      {!data?.computedAt ? (
        <div className="rounded-xl border border-gray-200 bg-[#fafafa] p-6 text-sm text-gray-600">
          Nothing has been computed yet.
          {canRun ? " Use Recompute above to build the first set of figures." : ""}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Sales" value={total} hint="not archived" />
            <Card
              label="Complete"
              value={complete}
              tone="text-[#4a5d0f]"
              hint={total ? `${Math.round((complete / total) * 100)}% by this module's rule` : undefined}
            />
            <Card
              label="Fully verified"
              value={verified}
              tone="text-[#4a5d0f]"
              hint={total ? `${Math.round((verified / total) * 100)}% of sales` : undefined}
            />
            <Card
              label="Open corrections"
              value={value(m, "corrections.open")}
              tone={value(m, "corrections.open") > 0 ? "text-amber-700" : undefined}
              hint="waiting on Sales"
            />
          </div>

          {/* The disagreement, stated rather than buried. This is finding 2 as
              a number: the sales app calls these sales incomplete and this
              module's rule calls them complete. */}
          {disagreement > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {NUMBER.format(disagreement)} sales are complete by this module&apos;s rule and
                  &quot;incomplete&quot; to the sales app
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  The sales app reports {NUMBER.format(appSays)} completed. Its rule still
                  requires a stove photo and an agreement document that the Sell Stove form
                  made optional, so counting on it would understate the work done. This
                  module counts the seven fields listed in workflow_config instead.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Bars
              title="Verification"
              subtitle="Never called is its own bucket: it is a different problem from called and not confirmed."
              data={verification}
            />
            <Bars title="Stock" data={stock} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Bars title="Sales by partner" subtitle="Top 10" data={byPartner} />
            <Bars title="Sales by state" subtitle="Top 10" data={byState} />
          </div>

          <Bars title="Sales by month" subtitle="Last 12 months" data={byMonth} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Calls logged" value={value(m, "calls.attempts_total")} />
            <Card
              label="Average calls"
              value={value(m, "calls.avg_attempts")}
              hint="per record worked"
            />
            <Card
              label="Chased 3 times"
              value={value(m, "calls.exhausted")}
              hint="still not verified"
              tone={value(m, "calls.exhausted") > 0 ? "text-amber-700" : undefined}
            />
            <Card
              label="Imported rows"
              value={value(m, "import.rows_committed")}
              hint={`${NUMBER.format(value(m, "import.exceptions_open"))} exceptions open`}
            />
          </div>
        </>
      )}
    </div>
  );
}

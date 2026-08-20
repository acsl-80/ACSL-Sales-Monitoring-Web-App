import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { dataCenterDashboard, DataCenterError } from "../../lib/client";
import Scorecard from "./Scorecard";
import {
  BarChart3, Loader2, AlertTriangle, RefreshCw, Clock, TriangleAlert, ArrowUpRight,
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
      // The whole dimension travels with the row, because a link needs what
      // the label does not carry: sales.by_partner records the organization id
      // beside the name, and filtering by name would be a guess.
      dim: m.dimension ?? {},
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * A figure, and the way to the rows behind it.
 *
 * Every number here used to be a dead end: the dashboard said 34 unreachable
 * and the only way to see which 34 was to go and rebuild the filter by hand.
 * A card with a `to` is a link to exactly the rows it counted.
 */
function Card({ label, value: v, hint, tone, to, search, arrow }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-gray-900"}`}>
        {typeof v === "number" ? NUMBER.format(v) : v}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </>
  );

  if (!to) {
    return <div className="rounded-xl border border-gray-200 bg-white p-4">{body}</div>;
  }

  return (
    <Link
      to={to}
      search={search ?? {}}
      aria-label={`${label}: ${typeof v === "number" ? NUMBER.format(v) : v}. ${arrow ?? "See the records"}`}
      className="group relative block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-(--dc-accent)/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--dc-accent)"
    >
      {body}
      <ArrowUpRight
        aria-hidden="true"
        className="absolute right-3 top-3 h-4 w-4 text-gray-300 transition group-hover:text-(--dc-accent)"
      />
    </Link>
  );
}

const BAR_TONES = {
  fully_verified: "bg-(--dc-primary)",
  partially_verified: "bg-amber-500",
  doubtful_verification: "bg-orange-500",
  not_verified: "bg-gray-400",
  never_called: "bg-gray-300",
  sold: "bg-(--dc-primary)",
  available: "bg-blue-400",
};

/**
 * A breakdown, every row of which is a door.
 *
 * `linkFor(row)` returns the destination for that row, or null where no
 * surface holds those records. A row with nowhere to go stays plain rather
 * than pretending: an affordance that leads nowhere is worse than none.
 */
function Bars({ title, data, subtitle, emptyText, linkFor }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  const rowBody = (d) => (
    <>
      <span className="w-32 shrink-0 truncate text-gray-700 sm:w-40" title={d.label}>
        {d.label.replace(/_/g, " ")}
      </span>
      <span className="h-4 min-w-0 flex-1 overflow-hidden rounded bg-gray-100">
        <span
          className={`block h-full rounded ${BAR_TONES[d.label] ?? "bg-(--dc-primary-mid)"}`}
          style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
        />
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums text-gray-700 sm:w-24">
        {NUMBER.format(d.value)}
        {total > 0 && (
          <span className="ml-1 text-xs text-gray-400">
            {Math.round((d.value / total) * 100)}%
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{emptyText ?? "Nothing to show yet."}</p>
      ) : (
        <ul className="mt-3 space-y-0.5">
          {data.map((d) => {
            const target = linkFor?.(d) ?? null;
            if (!target) {
              return (
                <li key={d.label} className="flex items-center gap-2 px-1.5 py-1 text-sm">
                  {rowBody(d)}
                </li>
              );
            }
            return (
              <li key={d.label}>
                <Link
                  to={target.to}
                  search={target.search ?? {}}
                  aria-label={`${d.label.replace(/_/g, " ")}: ${NUMBER.format(d.value)}. See the records`}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition hover:bg-(--dc-accent-soft)/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--dc-accent)"
                >
                  {rowBody(d)}
                </Link>
              </li>
            );
          })}
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

  /**
   * Where each breakdown row goes.
   *
   * Written together so the whole mapping can be read at once, and so a row
   * with no home returns null rather than a link that lands somewhere close
   * enough. Everything here uses filters the server already accepts.
   */
  const linkVerification = (d) =>
    d.label === "never_called"
      ? { to: "/data-center/call-centre", search: { preset: "todo" } }
      : {
        to: "/data-center/call-centre",
        search: { verificationOutcome: d.label, label: d.label.replace(/_/g, " ") },
      };

  const linkPartner = (d) =>
    d.dim?.organization_id
      ? {
        to: "/data-center/stove-records",
        search: { organizationId: d.dim.organization_id, label: d.label },
      }
      : null;

  const linkState = (d) => ({
    to: "/data-center/stove-records",
    search: { userState: d.label, label: d.label },
  });

  // A month bar covers that calendar month. The end is the last day, computed
  // rather than assumed, so February and the 30-day months are right.
  const linkMonth = (d) => {
    const match = /^(\d{4})-(\d{2})$/.exec(d.label);
    if (!match) return null;
    const [, year, month] = match;
    const last = new Date(Number(year), Number(month), 0).getDate();
    return {
      to: "/data-center/stove-records",
      search: {
        dateFrom: `${year}-${month}-01`,
        dateTo: `${year}-${month}-${String(last).padStart(2, "0")}`,
        label: d.label,
      },
    };
  };

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
        <BarChart3 className="h-4 w-4 text-(--dc-primary)" />
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
        <div className="rounded-xl border border-gray-200 bg-(--dc-surface-muted) p-6 text-sm text-gray-600">
          Nothing has been computed yet.
          {canRun ? " Use Recompute above to build the first set of figures." : ""}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card
              label="Sales"
              value={total}
              hint="not archived"
              to="/data-center/stove-records"
            />
            <Card
              label="Complete"
              value={complete}
              tone="text-(--dc-primary)"
              hint={total ? `${Math.round((complete / total) * 100)}% by this module's rule` : undefined}
              // The table can only filter on the sales app's own status, which
              // is the very thing this module disagrees with, so the link lands
              // on that reading and the drill banner says so rather than
              // presenting a different number as the same one.
              to="/data-center/stove-records"
              search={{ saleStatus: "completed", label: "Complete" }}
            />
            <Card
              label="Fully verified"
              value={verified}
              tone="text-(--dc-primary)"
              hint={total ? `${Math.round((verified / total) * 100)}% of sales` : undefined}
              to="/data-center/call-centre"
              search={{ status: "verified", label: "Fully verified" }}
            />
            <Card
              label="Open corrections"
              value={value(m, "corrections.open")}
              tone={value(m, "corrections.open") > 0 ? "text-amber-700" : undefined}
              hint="waiting on Sales"
              to="/data-center/call-centre"
              search={{ preset: "correction" }}
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
                <Link
                  to="/data-center/stove-records"
                  search={{ saleStatus: "incomplete", label: "Incomplete" }}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline-offset-2 hover:underline"
                >
                  See the records the sales app calls incomplete
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Bars
              title="Verification"
              subtitle="Never called is its own bucket: it is a different problem from called and not confirmed."
              data={verification}
              linkFor={linkVerification}
            />
            {/* Stock rows have no surface of their own: nothing lists stoves by
                status. Partner Records answers the nearest real question, what
                was sent to whom, so the rows stay plain rather than promising
                a filter that does not exist. */}
            <Bars title="Stock" data={stock} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Bars
              title="Sales by partner"
              subtitle="Top 10"
              data={byPartner}
              linkFor={linkPartner}
            />
            <Bars
              title="Sales by state"
              subtitle="Top 10"
              data={byState}
              linkFor={linkState}
            />
          </div>

          <Bars
            title="Sales by month"
            subtitle="Last 12 months"
            data={byMonth}
            linkFor={linkMonth}
          />

          {/* The five scorecards: one component, five dimensions, and that is
              the point. The first three read the transfer funnel (what was
              shipped), the last two read assignments (what was handed out).
              Every status cell drills into the queue behind its number. */}
          <div className="space-y-3">
            <Scorecard title="Partner" by="partner" metrics={m}
              hint="What each partner was sent, against what has come back." />
            <Scorecard title="Location" by="location" metrics={m}
              hint="The same funnel, cut by the partner's state." />
            <Scorecard title="Sales Representative" by="sales_rep" metrics={m}
              hint="The rep on the transfer, not the call centre agent." />
            <Scorecard title="Call Agent" by="call_agent" metrics={m}
              hint="Records handed to each agent, and what each became. Reclaimed batches are not counted." />
            <Scorecard title="Manager" by="manager" metrics={m}
              hint="Every agent reporting to them, rolled up. Sparse until reporting lines are set on profiles." />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card
              label="Calls logged"
              value={value(m, "calls.attempts_total")}
              to="/data-center/call-centre"
            />
            <Card
              label="Average calls"
              value={value(m, "calls.avg_attempts")}
              hint="per record worked"
              to="/data-center/call-centre"
            />
            <Card
              label="Chased 3 times"
              value={value(m, "calls.exhausted")}
              hint="still not verified"
              tone={value(m, "calls.exhausted") > 0 ? "text-amber-700" : undefined}
              to="/data-center/call-centre"
              search={{ preset: "exhausted" }}
            />
            <Card
              label="Imported rows"
              value={value(m, "import.rows_committed")}
              hint={`${NUMBER.format(value(m, "import.exceptions_open"))} exceptions open`}
              to="/data-center/import"
            />
          </div>
        </>
      )}
    </div>
  );
}

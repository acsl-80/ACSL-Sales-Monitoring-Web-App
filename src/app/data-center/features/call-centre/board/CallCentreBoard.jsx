import { useState } from "react";
import Link from "@/compat/Link";
import { dataCenterDashboard, DataCenterError } from "../../../lib/client";
import { metricValue } from "../../../lib/metricValue";
import { plural } from "../../../lib/plural";
import { whenOf } from "../../../lib/when";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";

/**
 * The board: what is callable, what is new, who holds what, and the work that
 * came back. Every figure opens the rows behind it, so a number is a door and
 * never a decoration.
 *
 * Counts over sales come from compute (`pool.*`, `calls.*`, `corrections.*`,
 * `verification.*`), read from the newest run; the "in progress" tile is live
 * from the small assignment tables. Recompute runs the pool family alone,
 * which is cheap enough to press.
 */

function Tile({ label, value, sub, href, tone = "plain" }) {
  const tones = {
    plain: "border-gray-200 bg-white hover:border-(--dc-accent)/50",
    red: "border-red-200 bg-red-50 hover:border-red-400",
    amber: "border-amber-200 bg-amber-50 hover:border-amber-400",
    accent: "border-(--dc-accent)/30 bg-(--dc-accent-soft)/40 hover:border-(--dc-accent)",
  };
  const body = (
    <>
      <span className="block text-xs font-medium uppercase tracking-wide text-gray-600">{label}</span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums text-gray-900">{value.toLocaleString()}</span>
      {sub && <span className="mt-0.5 block text-xs text-gray-600">{sub}</span>}
      {href && <ArrowRight className="absolute right-3 top-3 h-3.5 w-3.5 text-gray-400" aria-hidden />}
    </>
  );
  const cls = `relative block rounded-xl border p-3 text-left transition ${tones[tone]}`;
  // An in-page anchor is not a route: the router would fold the hash into
  // the path and drop the queue's search. A plain anchor scrolls.
  if (href && href.startsWith("#")) {
    return (
      <a href={href} className={cls} data-board-tile={label}>
        {body}
      </a>
    );
  }
  return href ? (
    <Link href={href} className={cls} data-board-tile={label}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-board-tile={label}>{body}</div>
  );
}

export default function CallCentreBoard({ metrics, agents, waiting, canManage, onRecomputed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const m = metrics?.metrics ?? [];

  const openBatches = (agents?.agents ?? []).reduce((n, a) => n + (a.open_batches ?? 0), 0);
  const holding = (agents?.agents ?? []).filter((a) => a.open_batches > 0).length;
  const held = (agents?.agents ?? []).reduce((n, a) => n + (a.records_held ?? 0), 0);

  const recompute = async () => {
    setBusy(true);
    setError(null);
    try {
      await dataCenterDashboard.run(["pool"]);
      await onRecomputed?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not recompute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">Board</h2>
        <span className="text-xs text-gray-600">every figure opens the rows behind it</span>
        <span className="ml-auto text-xs text-gray-500">
          {metrics?.poolComputedAt ?? metrics?.computedAt
            ? `pool computed ${whenOf(metrics.poolComputedAt ?? metrics.computedAt)}`
            : "no figures yet"}
          {agents?.refreshSeconds ? `, refreshes every ${agents.refreshSeconds} s` : ""}
        </span>
        {canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={recompute}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {busy ? "Computing..." : "Recompute"}
          </button>
        )}
      </header>
      {error && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <Tile
          label="Callable now"
          value={metricValue(m, "pool.callable")}
          sub={`across ${plural(metricValue(m, "pool.partners"), "partner")}`}
          href="#pool-by-partner"
          tone="accent"
        />
        <Tile
          label="New this week"
          value={metricValue(m, "pool.recent")}
          sub="digitised lately, still callable"
          href="#pool-by-partner"
        />
        <Tile
          label="In progress"
          value={held}
          sub={`${plural(openBatches, "open batch", "open batches")}, ${plural(holding, "agent")}`}
          href="#agents-panel"
        />
        <Tile
          label="Never called"
          value={metricValue(m, "pool.never_called")}
          sub="sold stoves without a record"
          href="/data-center/call-centre?preset=todo"
        />
        <Tile
          label="Waiting on Sales"
          value={waiting?.openAll ?? metricValue(m, "corrections.open")}
          sub="sent back, not in the pool"
          href="/data-center/corrections?tab=open"
          tone="red"
        />
        <Tile
          label="Awaiting review"
          value={waiting?.fixedAll ?? metricValue(m, "corrections.fixed")}
          sub="fixed by Sales"
          href="/data-center/corrections?tab=fixed"
          tone="amber"
        />
        <Tile
          label="Stuck at the limit"
          value={metricValue(m, "calls.exhausted")}
          sub="every call made, still unresolved"
          href="/data-center/call-centre?preset=exhausted"
        />
        <Tile
          label="Unreachable"
          value={metricValue(m, "verification.by_outcome", { outcome: "unreachable" })}
          sub="nobody answered on any call"
          href="/data-center/call-centre?verificationOutcome=unreachable"
        />
      </div>
    </section>
  );
}

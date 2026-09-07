import { useState } from "react";
import Door from "./Door";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { dataCenterDashboard, DataCenterError } from "../../../lib/client";
import { metricValue } from "../../../lib/metricValue";
import { whenOf } from "../../../lib/when";

/**
 * Today, in numbers (Phase 26, C2). Six figures, each a door to the rows it
 * counts, each in the colour of what it leads to. The two on the left are the
 * chosen day's; the four on the right are always now.
 *
 * The day's two come from the board read (calls logged against the login that
 * logged them, D35). The standing four come from compute (`pool.callable`,
 * `corrections.open`, `verification.by_outcome`) and the live batches, so
 * Recompute stays here: it runs the pool family alone, which is cheap.
 *
 * `data-board-tile` and the value in the second span are the contract the
 * board spec reads; kept from the tiles this replaces.
 */
function Figure({ label, value, sub, href, tone, big = false }) {
  const tones = {
    sold: "bg-(--dc-fig-sold)",
    verified: "bg-(--dc-fig-verified)",
    transferred: "bg-(--dc-fig-transferred)",
    plum: "bg-(--dc-fig-plum)",
    unverified: "bg-(--dc-fig-unverified)",
    crit: "bg-(--dc-fig-crit)",
  };
  const body = (
    <>
      <span className="block text-xs font-medium text-white/90">{label}</span>
      <span className={`mt-1 block font-semibold tabular-nums text-white ${big ? "text-3xl" : "text-2xl"}`}>
        {Number(value ?? 0).toLocaleString()}
      </span>
      {sub && <span className="mt-0.5 block text-[11px] text-white/80">{sub}</span>}
      <ArrowRight className="absolute right-3 top-3 h-3.5 w-3.5 text-white/70" aria-hidden />
    </>
  );
  const cls = `relative block rounded-xl p-3 text-left shadow-sm transition hover:-translate-y-px ${tones[tone]}`;
  return (
    <Door href={href} className={cls} data-board-tile={label}>
      {body}
    </Door>
  );
}

export default function Figures({ board, metrics, waiting, canManage, onRecomputed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const m = metrics?.metrics ?? [];
  const agents = board?.agents ?? [];
  const openBatches = agents.reduce((n, a) => n + (a.open_batches ?? 0), 0);
  const holding = agents.filter((a) => a.open_batches > 0).length;
  const dayWord = board?.range === "week" ? "this week" : board?.day === board?.today ? "today" : "that day";

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
    <section aria-labelledby="cc-figures" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="cc-figures" className="text-sm font-semibold text-gray-900">Board</h2>
        <span className="text-xs text-gray-600">every figure opens the rows behind it</span>
        <span className="ml-auto text-xs text-gray-500">
          {metrics?.poolComputedAt ?? metrics?.computedAt
            ? `pool computed ${whenOf(metrics.poolComputedAt ?? metrics.computedAt)}`
            : "no figures yet"}
          {board?.refreshSeconds ? `, refreshes every ${board.refreshSeconds} s` : ""}
        </span>
        {canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={recompute}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {busy ? "Computing..." : "Recompute"}
          </button>
        )}
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Figure
          label={`Calls made ${dayWord}`}
          value={board?.totals?.called}
          sub="logged by the agents"
          href="#agents-panel"
          tone="sold"
          big
        />
        <Figure
          label={`Verified ${dayWord}`}
          value={board?.totals?.verified}
          sub="fully verified and saved"
          href="/data-center/call-centre?verificationOutcome=fully_verified"
          tone="verified"
          big
        />
        <Figure
          label="Waiting to be called"
          value={metricValue(m, "pool.callable")}
          sub="callable now, in the pool"
          href="/data-center/call-centre/partners"
          tone="transferred"
        />
        <Figure
          label="Batches in hand"
          value={openBatches}
          sub={`${holding} of ${agents.length} agents holding work`}
          href="#agents-panel"
          tone="plum"
        />
        <Figure
          label="Waiting on Sales"
          value={waiting?.openAll ?? metricValue(m, "corrections.open")}
          sub="sent back, not in the pool"
          href="/data-center/corrections?tab=open"
          tone="unverified"
        />
        <Figure
          label="Unreachable"
          value={metricValue(m, "verification.by_outcome", { outcome: "unreachable" })}
          sub="nobody answered on any call"
          href="/data-center/call-centre?verificationOutcome=unreachable"
          tone="crit"
        />
      </div>
    </section>
  );
}

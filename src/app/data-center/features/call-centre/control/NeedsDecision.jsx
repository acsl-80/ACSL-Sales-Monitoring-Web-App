import { useEffect, useState } from "react";
import Door from "./Door";
import { RotateCcw } from "lucide-react";
import { dataCenterAssign, dataCenterClient, DataCenterError } from "../../../lib/client";
import ConfirmDialog from "../../../components/ConfirmDialog";
import { metricValue } from "../../../lib/metricValue";
import { plural } from "../../../lib/plural";

/**
 * Needs a decision (Phase 26, C2). Five lines, each a count and the verb
 * that clears it, in the colour of the verb. Collapsed to counts on purpose:
 * the work happens on the page each verb opens, and this card exists so a
 * manager sees in one glance whether anything is waiting on them.
 *
 *   Shared phone numbers, unconfirmed   Review   the register on this page
 *   Fixed by Sales, awaiting review      Review   the corrections list
 *   Stuck at the call limit              Open     the queue, exhausted preset
 *   Batches idle past the stale age      Reclaim  the engine's reclaim, confirmed
 *   Agents over capacity                 Open     the board
 */
function Row({ label, count, sub, action }) {
  const tone = {
    review: "border-(--dc-brief-place) text-(--dc-brief-place) hover:bg-(--dc-brief-place-soft)",
    open: "border-(--dc-brief-stove) text-(--dc-brief-stove) hover:bg-(--dc-brief-stove-soft)",
    reclaim: "border-(--dc-brief-history) text-(--dc-brief-history) hover:bg-(--dc-brief-history-soft)",
  }[action.tone];
  const cls = `inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold transition ${tone}`;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-decision={label}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-900">{label}</span>
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </span>
      <span className={`tabular-nums text-sm font-semibold ${count > 0 ? "text-gray-900" : "text-gray-400"}`}>{count == null ? "…" : count.toLocaleString()}</span>
      {action.href ? (
        <Door href={action.href} className={cls}>{action.text}</Door>
      ) : (
        <button type="button" onClick={action.onClick} disabled={!count} className={`${cls} disabled:opacity-40`}>{action.icon}{action.text}</button>
      )}
    </li>
  );
}

export default function NeedsDecision({ board, agentsMeta, metrics, waiting, canManage, reload }) {
  const [phones, setPhones] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let alive = true;
    dataCenterClient
      .sharedPhones({ limit: 200 })
      .then((r) => {
        if (!alive) return;
        const open = (r.rows ?? []).filter((g) => !g.any_confirmed);
        setPhones({ numbers: open.length, stoves: open.reduce((n, g) => n + (g.stoves?.length ?? 0), 0) });
      })
      .catch(() => alive && setPhones({ numbers: 0, stoves: 0 }));
    return () => { alive = false; };
  }, [board?.day]);

  const m = metrics?.metrics ?? [];
  const agents = board?.agents ?? [];
  const defaultCap = agentsMeta?.defaultCap ?? 1;
  const staleDays = board?.staleAfterDays ?? 3;
  const staleMs = staleDays * 86_400_000;
  const idleAgents = (agentsMeta?.agents ?? []).filter(
    (a) => a.open_batches > 0 && a.last_activity_at && Date.now() - new Date(a.last_activity_at).getTime() > staleMs,
  );
  const over = agents.filter((a) => a.open_batches > (a.max_open_batches ?? defaultCap));

  const reclaim = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await dataCenterAssign.reclaim();
      setNotice(out.reclaimed ? `${plural(out.reclaimed, "quiet batch", "quiet batches")} reclaimed.` : "Nothing to reclaim: every open batch has recent activity.");
      await reload?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Reclaim failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="cc-decisions" className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-brief-place) bg-white shadow-sm">
      <ConfirmDialog
        open={confirm}
        title="Reclaim quiet batches?"
        description={`Every open batch with no activity for ${plural(staleDays, "day")} goes back to the pool, and its agent loses it. Calls already logged stay on the records.`}
        cancelLabel="Not now"
        actionLabel="Reclaim"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); reclaim(); }}
      />
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-brief-place-soft)/30 px-4 py-2.5">
        <h2 id="cc-decisions" className="text-sm font-semibold text-gray-900">Needs a decision</h2>
        <span className="text-xs text-gray-600">counts, and the verb that clears them</span>
      </header>
      {notice && <p className="mx-4 mt-3 rounded-md bg-(--dc-accent-soft)/60 px-3 py-2 text-xs text-(--dc-accent-strong)">{notice}</p>}
      {error && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <ul className="divide-y divide-gray-100">
        <Row
          label="Shared phone numbers, unconfirmed"
          sub={phones ? `${plural(phones.numbers, "number")} on ${plural(phones.stoves, "stove")}, nobody has rung them yet` : "reading the register"}
          count={phones?.numbers}
          action={{ tone: "review", text: "Review", href: "#shared-phones" }}
        />
        <Row
          label="Fixed by Sales, awaiting review"
          sub="the call centre confirms the fix and rings again"
          count={waiting?.fixedAll ?? metricValue(m, "corrections.fixed")}
          action={{ tone: "review", text: "Review", href: "/data-center/corrections?tab=fixed" }}
        />
        <Row
          label="Stuck at the call limit"
          sub="every allowed call made, still not verified"
          count={metricValue(m, "calls.exhausted")}
          action={{ tone: "open", text: "Open", href: "/data-center/call-centre?preset=exhausted" }}
        />
        <Row
          label={`Batches idle past ${plural(staleDays, "day")}`}
          sub={idleAgents.length ? idleAgents.map((a) => a.full_name || a.email).join(", ") : "every open batch has recent activity"}
          count={idleAgents.length}
          action={canManage
            ? { tone: "reclaim", text: "Reclaim", onClick: () => setConfirm(true), icon: <RotateCcw className="h-3.5 w-3.5" /> }
            : { tone: "open", text: "Open", href: "#agents-panel" }}
        />
        <Row
          label="Agents over capacity"
          sub={over.length ? over.map((a) => `${a.full_name || a.email} ${a.open_batches} of ${a.max_open_batches ?? defaultCap}`).join(", ") : "everyone is within their cap"}
          count={over.length}
          action={{ tone: "open", text: "Open", href: "#agents-panel" }}
        />
      </ul>
    </section>
  );
}

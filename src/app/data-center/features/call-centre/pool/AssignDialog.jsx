import { useEffect, useState } from "react";
import { dataCenterAssign, DataCenterError } from "../../../lib/client";
import { plural } from "../../../lib/plural";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, UserPlus } from "lucide-react";
import StandingBar from "../../../components/StandingBar";

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString() : "-");


/**
 * Pick a partner, pick how many, assign.
 *
 * The partner list is the pool: only partners with records still needing a
 * call, largest backlog first. Offering a partner with nothing left would be
 * offering a button that does nothing.
 */
export default function AssignDialog({ agent = null, agents = [], initialOrgId = "", pool, batchSize, priority, onDone, onClose }) {
  const [orgId, setOrgId] = useState(initialOrgId);
  // Opened from an agent's row the agent is fixed; opened from a partner's
  // row the supervisor picks who takes it.
  const [agentId, setAgentId] = useState(agent?.agent_id ?? "");
  const chosenAgent = agent ?? agents.find((a) => a.agent_id === agentId) ?? null;
  const [size, setSize] = useState(String(batchSize));
  // The order the picker hands records out in. The configured default
  // leads; a supervisor may put another first ("newest first" for a
  // partner whose records just landed) and the rest of the default follows
  // as the tie-break.
  const orderOptions = priority?.options ?? [];
  const defaultOrder = priority?.order ?? [];
  // Untouched, the dialog sends no order and the picker applies the
  // configured one, including any per-partner override. Only a choice the
  // supervisor made travels. The shown default falls back to an offered
  // option so the words on screen are the words that are sent.
  const shownDefault = orderOptions.some((o) => o.value === defaultOrder[0])
    ? defaultOrder[0]
    : orderOptions[0]?.value ?? "";
  const [orderFirst, setOrderFirst] = useState(shownDefault);
  const [orderTouched, setOrderTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState([]);
  // Capacity is a refusal with a door in it: when the server says the agent
  // is at capacity, the supervisor may give a reason and hand out more.
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState("");

  const partner = pool.find((p) => p.organization_id === orgId);
  const cap = partner ? Math.min(Number(size) || 0, partner.callable) : Number(size) || 0;
  /**
   * Phase 28, D46: where each partner's records stand, read live once when
   * the dialog opens. The rows show never called and in progress beside the
   * hand-out count; the chosen partner gets the whole six-way bar.
   */
  const [standing, setStanding] = useState(null);
  useEffect(() => {
    let alive = true;
    dataCenterAssign.partnerStanding()
      .then((d) => alive && setStanding(new Map(d.rows.map((r) => [r.organization_id, r]))))
      .catch(() => alive && setStanding(new Map()));
    return () => { alive = false; };
  }, []);
  const standingOf = (id) => standing?.get(id) ?? null;
  /**
   * The preview (Phase 26, C3): the rows the picker would hand out, read live
   * through the same picker the engine uses, so what is shown is what lands.
   * Debounced, because the size box is typed into; superseded answers are
   * dropped by sequence so a slow earlier read never overwrites a later one.
   */
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!agentId || !orgId || cap < 1) {
      setPreview(null);
      return undefined;
    }
    let alive = true;
    setPreviewBusy(true);
    const order = orderTouched && orderFirst ? [orderFirst, ...defaultOrder.filter((tk) => tk !== orderFirst)] : null;
    const timer = setTimeout(() => {
      dataCenterAssign
        .assignPreview({ agentId, organizationId: orgId, size: cap, order })
        .then((d) => {
          if (!alive) return;
          setPreview(d);
          setShowAll(false);
          // Both ways: switching to an agent with room takes the reason box away.
          setNeedsReason(Boolean(d.agent?.over_capacity));
        })
        .catch((err) => alive && setError(err instanceof DataCenterError ? err.message : "Could not preview that hand-out."))
        .finally(() => alive && setPreviewBusy(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, orgId, cap, orderFirst, orderTouched]);

  const assign = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = orderTouched && orderFirst
        ? [orderFirst, ...defaultOrder.filter((t) => t !== orderFirst)]
        : null;
      const result = await dataCenterAssign.assignManual(
        agentId,
        orgId,
        cap,
        needsReason && reason.trim() ? reason.trim() : null,
        order,
      );
      if (result.size === 0) {
        setError("That partner had nothing left by the time the batch was made.");
      } else {
        setDone((d) => [...d, { partner: partner?.partner_name, size: result.size }]);
        setOrgId("");
        // A reason belongs to the batch it justified, not to the next one.
        setReason("");
        setNeedsReason(false);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not assign that batch.");
      if (err instanceof DataCenterError && err.code === "over_capacity") setNeedsReason(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="dc-root flex max-h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area="call-centre"
      >
        <DialogHeader className="border-b border-gray-100 bg-(--dc-accent-soft)/40 px-5 py-4 text-left">
          <DialogTitle className="text-base">
            Assign work to {chosenAgent ? chosenAgent.full_name || chosenAgent.email : "an agent"}
          </DialogTitle>
          <DialogDescription>
            One partner at a time. Assign again to add a second partner: an agent
            holding ten of one and ten of another is two batches, never one mixed
            queue.
          </DialogDescription>
        </DialogHeader>

        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-5">
          {!agent && (
            <div className="mb-4">
              <label htmlFor="assign-agent" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Who takes it
              </label>
              <select
                id="assign-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full max-w-sm rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
              >
                <option value="">Pick an agent</option>
                {agents.filter((a) => a.is_enabled).map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.full_name || a.email} ({a.open_batches} open)
                  </option>
                ))}
              </select>
            </div>
          )}
          {done.length > 0 && (
            <ul className="mb-4 space-y-1 rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/40 p-3 text-sm">
              {done.map((d, i) => (
                <li key={`${d.partner}-${i}`} className="text-(--dc-accent-strong)">
                  Assigned {plural(d.size, "record")} from {d.partner}
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {needsReason && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label htmlFor="assign-override-reason" className="block text-xs font-semibold uppercase tracking-wide text-amber-900">
                Why hand out more than their capacity
              </label>
              <textarea
                id="assign-override-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Covering for a colleague, a partner that must finish today..."
                className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <p className="mt-1 text-xs text-amber-900">The reason lands on the batch, so the log says why. Assign again to send it.</p>
            </div>
          )}

          {pool.length === 0 ? (
            <div className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
              Nothing is waiting to be called. Every record has either been
              concluded or is already someone else&apos;s work.
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                Partners with work waiting
              </p>
              <ul className="mb-4 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                {pool.map((p) => {
                  const selected = p.organization_id === orgId;
                  return (
                    <li key={p.organization_id}>
                      <button
                        type="button"
                        onClick={() => setOrgId(p.organization_id)}
                        aria-pressed={selected}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                          selected
                            ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                            : "hover:bg-(--dc-accent-soft)/40"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.partner_name}</span>
                          {standingOf(p.organization_id) && (
                            <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-gray-600" data-partner-standing={p.organization_id}>
                              <span className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-2 w-2 rounded-[2px] bg-(image:--dc-fig-transferred)" /><b className="tabular-nums" data-never-called>{standingOf(p.organization_id).never_called}</b> never called</span>
                              <span className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-2 w-2 rounded-[2px] bg-gray-400" /><b className="tabular-nums" data-in-progress>{standingOf(p.organization_id).in_progress}</b> in progress</span>
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block tabular-nums font-medium">{p.callable} to hand out</span>
                          <span className="block text-xs text-gray-600">oldest {dateOf(p.oldest)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                    How many
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-28 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm tabular-nums focus:border-(--dc-accent) focus:outline-none"
                  />
                </label>
                {orderOptions.length > 0 && (
                  <div>
                    <label htmlFor="assign-order" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                      Hand-out order
                    </label>
                    <select
                      id="assign-order"
                      value={orderFirst}
                      onChange={(e) => {
                        setOrderFirst(e.target.value);
                        setOrderTouched(true);
                      }}
                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
                    >
                      {orderOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="pb-2 text-sm text-gray-600" data-preview-summary>
                  {!partner
                    ? "Pick a partner above"
                    : preview
                    ? `${plural(preview.size, "record")} from ${partner.partner_name}, leaving ${preview.waitingAfter} waiting`
                    : `${plural(cap, "record")} from ${partner.partner_name}`}
                </p>
                <button
                  type="button"
                  disabled={busy || !orgId || !agentId || cap < 1 || (preview != null && preview.size === 0)}
                  onClick={assign}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  {preview && preview.size > 0 && chosenAgent
                    ? `${needsReason ? "Hand out anyway" : "Hand out"} ${preview.size} to ${chosenAgent.full_name || chosenAgent.email}`
                    : "Assign"}
                </button>
              </div>
              {/* Phase 28, D46: the chosen partner's records by standing. What a
                  hand-out draws from is never called and in progress; the rest
                  are out of the pool and this says how many. */}
              {partner && standingOf(partner.organization_id) && (
                <section className="mt-4 rounded-lg border border-gray-200 border-t-[3px] border-t-(--dc-accent)" data-partner-standing-panel={partner.organization_id}>
                  <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/40 px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-900">{partner.partner_name}, where things stand</span>
                    <span className="ml-auto text-xs text-gray-600">{plural(standingOf(partner.organization_id).total, "record")}</span>
                  </header>
                  <div className="px-3 py-3">
                    <StandingBar counts={standingOf(partner.organization_id)} legend />
                    <p className="mt-2 text-xs text-gray-600">
                      Never called and in progress are what a hand-out draws from. Verified, partly verified, unreachable and with Sales are out of the pool.
                    </p>
                  </div>
                </section>
              )}
              {/* What will land, before it does. The first five rows, the rest
                  on request; nothing here is written until the button above. */}
              {partner && agentId && (
                <section className="mt-4 rounded-lg border border-gray-200" data-assign-preview aria-live="polite">
                  <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/40 px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-900">
                      {previewBusy && !preview
                        ? "Reading what would be handed out..."
                        : preview
                        ? preview.size > 0
                          ? `These ${plural(preview.size, "record")} will be handed out`
                          : "Nothing to hand out"
                        : ""}
                    </span>
                    {preview && (
                      <span className="text-xs text-gray-600">
                        {preview.recentCount > 0 ? `${preview.recentCount} digitised in the last ${plural(preview.recentDays, "day")} · ` : ""}
                        {chosenAgent ? `${chosenAgent.full_name || chosenAgent.email} holds ${preview.agent.open_batches} of ${preview.agent.cap} ${preview.agent.cap === 1 ? "batch" : "batches"}` : ""}
                        {preview.agent?.over_capacity ? " · over capacity, a reason is needed" : ""}
                      </span>
                    )}
                    {previewBusy && preview && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-gray-500" />}
                  </header>
                  {/* Slice 5: what this order does, in one line, so the manager can
                      reorient before the batch lands. New numbers first is the
                      configured default; another order says what it puts ahead. */}
                  {preview && preview.size > 0 && (
                    <p className="border-b border-gray-100 bg-(--dc-surface-muted) px-3 py-2 text-xs text-gray-700" data-handout-nudge>
                      {(() => {
                        const tried = preview.size - preview.untriedInBatch;
                        const firstLabel = orderOptions.find((o) => o.value === orderFirst)?.label ?? "This order";
                        const leadsNew = (orderTouched ? orderFirst : shownDefault) === "never_called";
                        if (leadsNew) {
                          return `New numbers first: ${preview.untriedInBatch} of this partner's ${preview.poolUntried} untried ${preview.poolUntried === 1 ? "number" : "numbers"}` +
                            (tried > 0 ? `, and ${tried} tried ${tried === 1 ? "one rides" : "ones ride"} along because the untried ran out.` : preview.poolTried > 0 ? `; ${preview.poolTried} tried ${preview.poolTried === 1 ? "one waits" : "ones wait"} behind them.` : ".");
                        }
                        return tried > 0 && preview.poolUntried > 0
                          ? `${firstLabel} puts ${tried} tried ${tried === 1 ? "number" : "numbers"} ahead of ${preview.poolUntried} new ${preview.poolUntried === 1 ? "one" : "ones"}. New numbers first is the default.`
                          : `${firstLabel}: ${preview.untriedInBatch} untried and ${tried} tried in this batch.`;
                      })()}
                    </p>
                  )}
                  {preview && preview.size === 0 && (
                    <p className="px-3 py-3 text-sm text-gray-600">
                      Nothing waiting at {partner.partner_name} right now: every record is concluded, with Sales, half-typed or already in someone&apos;s hands.
                    </p>
                  )}
                  {preview && preview.size > 0 && (
                    <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                            <th className="px-3 py-1.5 font-semibold">#</th>
                            <th className="px-3 py-1.5 font-semibold">Buyer</th>
                            <th className="px-3 py-1.5 font-semibold">Stove</th>
                            <th className="px-3 py-1.5 font-semibold">Phone</th>
                            <th className="px-3 py-1.5 font-semibold">Sold</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Tries</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(showAll ? preview.rows : preview.rows.slice(0, 5)).map((r) => (
                            <tr key={r.sale_id}>
                              <td className="px-3 py-1.5 tabular-nums text-gray-500">{r.pos}</td>
                              <td className="px-3 py-1.5 text-gray-900">{r.end_user_name ?? "-"}</td>
                              <td className="px-3 py-1.5 font-mono text-xs text-gray-700">{r.stove_serial_no}</td>
                              <td className="px-3 py-1.5 font-mono text-xs text-gray-700">{r.phone ?? "-"}</td>
                              <td className="px-3 py-1.5 text-xs text-gray-600">{dateOf(r.sales_date)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                                {Number(r.attempt_count ?? 0) === 0 ? "new" : r.attempt_count}{r.recall_due ? " · ring again" : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.rows.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setShowAll((v) => !v)}
                          className="w-full border-t border-gray-100 px-3 py-1.5 text-left text-xs font-medium text-(--dc-accent) hover:bg-(--dc-accent-soft)/40"
                        >
                          {showAll ? "Show the first five" : `and ${preview.rows.length - 5} more · show all ${preview.rows.length}`}
                        </button>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

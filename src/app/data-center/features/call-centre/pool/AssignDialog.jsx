import { useState } from "react";
import { dataCenterAssign, DataCenterError } from "../../../lib/client";
import { plural } from "../../../lib/plural";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, UserPlus } from "lucide-react";

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
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {p.partner_name}
                        </span>
                        <span className="shrink-0 text-xs text-gray-600">
                          oldest {dateOf(p.oldest)}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium">
                          {plural(p.callable, "record")}
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
                <p className="pb-2 text-sm text-gray-600">
                  {partner
                    ? `${plural(cap, "record")} from ${partner.partner_name}`
                    : "Pick a partner above"}
                </p>
                <button
                  type="button"
                  disabled={busy || !orgId || !agentId || cap < 1}
                  onClick={assign}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Assign
                </button>
              </div>
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

/* ------------------------------------------------------------- agent detail */

/**
 * One agent, opened: their batches by partner, and the records in each.
 *
 * Three levels of the same tree rather than three screens. Which partner, then
 * which serials, then the record itself, because that is the order the question
 * is actually asked in.
 */

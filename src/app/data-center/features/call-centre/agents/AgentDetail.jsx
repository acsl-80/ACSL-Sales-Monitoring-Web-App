import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterAssign, DataCenterError } from "../../../lib/client";
import ExportButton from "../../../components/ExportButton";
import { plural } from "../../../lib/plural";
import ConfirmDialog from "../../../components/ConfirmDialog";
import { Loader2, ChevronDown, ChevronRight, Undo2, PhoneOff, ExternalLink } from "lucide-react";

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString() : "-");

const ITEM_COLUMNS = [
  { key: "partner_name", label: "Partner" },
  { key: "stove_serial_no", label: "Stove serial" },
  { key: "number_on_record", label: "Phone" },
  { key: "sales_date", label: "Sold" },
  { key: "position", label: "Position in batch" },
  { key: "attempt_count", label: "Calls made" },
  { key: "call_outcome", label: "Last outcome" },
  { key: "verification_outcome", label: "Verification" },
  { key: "assigned_at", label: "Assigned" },
  { key: "batch_id", label: "Batch" },
  { key: "sale_id", label: "Sale id" },
];

/**
 * One agent, opened: their batches by partner, and the records in each.
 *
 * Three levels of the same tree rather than three screens. Which partner, then
 * which serials, then the record itself, because that is the order the question
 * is actually asked in.
 */
export default function AgentDetail({ agent, onChanged, onOpenRecord }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [openBatch, setOpenBatch] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await dataCenterAssign.agentDetail(agent.agent_id);
      setItems(r.items);
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load that agent.");
    }
  }, [agent.agent_id]);

  useEffect(() => {
    load();
  }, [load]);

  // Batches, in the order they were handed over. One pass rather than a group-by
  // helper: the list is what an agent holds, so it is tens of rows.
  const batches = useMemo(() => {
    const byId = new Map();
    for (const item of items ?? []) {
      if (!byId.has(item.batch_id)) {
        byId.set(item.batch_id, {
          batch_id: item.batch_id,
          partner_name: item.partner_name,
          assigned_at: item.assigned_at,
          last_activity_at: item.last_activity_at,
          items: [],
        });
      }
      byId.get(item.batch_id).items.push(item);
    }
    return [...byId.values()];
  }, [items]);

  const act = async () => {
    setBusy(true);
    try {
      if (confirm.kind === "batch") await dataCenterAssign.unassignBatch(confirm.batchId);
      else await dataCenterAssign.unassignItem(confirm.saleId);
      setConfirm(null);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not unassign that.");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="px-4 py-3 text-sm text-red-600">{error}</p>;
  if (items === null) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading what they hold...
      </p>
    );
  }
  if (batches.length === 0) {
    return (
      <div className="m-4 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-6 text-center text-sm text-gray-600">
        Holding nothing right now.
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex justify-end">
        <ExportButton
          columns={ITEM_COLUMNS}
          rows={() => items}
          filename={`assigned-${(agent.full_name || agent.email || "agent").replace(/\W+/g, "-").toLowerCase()}.csv`}
          label="Export what they hold"
        />
      </div>

      {batches.map((batch) => {
        const open = openBatch === batch.batch_id;
        return (
          <div
            key={batch.batch_id}
            className="overflow-hidden rounded-lg border border-(--dc-accent)/20 bg-white"
          >
            <div className="flex flex-wrap items-center gap-2 bg-(--dc-accent-soft)/40 px-3 py-2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenBatch(open ? null : batch.batch_id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-(--dc-accent-strong)"
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{batch.partner_name}</span>
                <span className="shrink-0 text-xs font-normal text-gray-600">
                  {plural(batch.items.length, "record")} · assigned {dateOf(batch.assigned_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    kind: "batch",
                    batchId: batch.batch_id,
                    label: `${plural(batch.items.length, "record")} from ${batch.partner_name}`,
                  })
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
              >
                <Undo2 className="h-3.5 w-3.5" /> Unassign batch
              </button>
            </div>

            {open && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b-2 border-(--dc-accent)/25 text-left text-xs uppercase tracking-wide text-gray-600">
                      <th className="w-10 px-3 py-1.5 text-right font-semibold">#</th>
                      <th className="px-3 py-1.5 font-semibold">Stove serial</th>
                      <th className="px-3 py-1.5 font-semibold">Phone</th>
                      <th className="px-3 py-1.5 font-semibold">Sold</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Calls</th>
                      <th className="w-24 px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {batch.items.map((item) => (
                      <tr key={item.sale_id} className="hover:bg-(--dc-accent-soft)/40">
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                          {item.position}
                        </td>
                        <td className="px-3 py-1.5">
                          {/*
                            Two different destinations, so two controls rather
                            than one that guesses. The serial opens the call
                            record, which is what a supervisor looking at a
                            queue wants; the arrow beside it opens the whole
                            history, which is what they want when the record
                            does not explain itself.
                          */}
                          <button
                            type="button"
                            onClick={() => onOpenRecord(item.sale_id)}
                            className="font-medium text-(--dc-accent) underline-offset-2 hover:underline"
                          >
                            {item.stove_serial_no}
                          </button>
                          <Link
                            href={`/data-center/stove/${encodeURIComponent(item.stove_serial_no)}`}
                            aria-label={`Everything about ${item.stove_serial_no}`}
                            title={`Everything about ${item.stove_serial_no}`}
                            className="ml-1.5 inline-block align-middle text-gray-400 transition hover:text-(--dc-accent)"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-700">
                          {item.number_on_record || "-"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">{dateOf(item.sales_date)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                          {item.attempt_count ?? 0}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            type="button"
                            aria-label={`Unassign ${item.stove_serial_no}`}
                            onClick={() =>
                              setConfirm({
                                kind: "item",
                                saleId: item.sale_id,
                                label: `stove ${item.stove_serial_no}`,
                              })
                            }
                            className="rounded p-1 text-gray-500 transition hover:bg-red-50 hover:text-red-700"
                          >
                            <PhoneOff className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={confirm !== null}
        title="Return this work to the pool?"
        description={
          <>
            {confirm?.label} goes back to being unassigned, and can be given to somebody
            else. Calls already logged against it stay where they are.
          </>
        }
        cancelLabel="Keep it assigned"
        actionLabel="Unassign"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={act}
      />
    </div>
  );
}

import ConfirmDialog from "../../components/ConfirmDialog";
import { useState } from "react";
import Link from "@/compat/Link";
import { dataCenterCall, DataCenterError } from "../../lib/client";
import { Package, Loader2, ArrowRight, Check, TriangleAlert } from "lucide-react";

/**
 * The buyer reads the number off the label and it does not match.
 *
 * Until now the only thing an agent could do with that was send the sale back
 * to Sales, where nobody has the buyer on the phone. This puts the fix where
 * the information is.
 *
 * Three outcomes, and the agent has to be told which one happened, because
 * they are not the same act:
 *
 *   - the number is not ours: nothing changed, read it back a digit at a time
 *   - the stove was free: this record now has it, the old one is back on the
 *     shelf, done
 *   - the stove belonged to another buyer: the two records exchanged stoves,
 *     and somebody now has to ring the other buyer
 *
 * The third one leaves work behind, so it says so plainly rather than showing
 * a tick and moving on.
 */
export default function SerialRematch({ saleId, currentSerial, canEdit, onDone }) {
  const [open, setOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  /** The form asks first; the move itself is `perform`, once confirmed. */
  const run = (e) => {
    e.preventDefault();
    if (!serial.trim()) return;
    setConfirming(true);
  };

  const perform = async () => {
    const value = serial.trim();
    setConfirming(false);
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dataCenterCall.serialRematch(saleId, value, note.trim() || undefined);
      setDone(result);
      setSerial("");
      setNote("");
      onDone?.(result);
    } catch (err) {
      setError(
        err instanceof DataCenterError
          ? err.message
          : "That serial number could not be changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) return null;

  if (done) {
    const swapped = done.kind === "swapped";
    return (
      <div
        className={`rounded-lg border p-3 ${
          swapped ? "border-amber-300 bg-amber-50" : "border-(--dc-accent)/30 bg-(--dc-accent-soft)/30"
        }`}
      >
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          {swapped ? (
            <TriangleAlert className="h-4 w-4 text-amber-600" />
          ) : (
            <Check className="h-4 w-4 text-(--dc-accent)" />
          )}
          This record now carries {done.toSerial}
        </p>
        <p className="mt-1 text-sm text-gray-800">
          <span className="font-mono">{done.fromSerial}</span>{" "}
          <ArrowRight className="inline h-3.5 w-3.5" />{" "}
          <span className="font-mono">{done.toSerial}</span>.{" "}
          {swapped
            ? "The two records exchanged stoves. The other buyer never confirmed anything, so their record is flagged and somebody has to ring them."
            : "The stove was unsold, so nobody else is affected and the old one is back on the shelf."}
        </p>
        {swapped && done.swappedWithSaleId && (
          <p className="mt-1.5">
            <Link
              href={`/data-center/stove/${encodeURIComponent(done.fromSerial)}`}
              className="text-sm font-medium text-amber-900 underline"
            >
              Open the record that now needs a call
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
      >
        <Package className="h-4 w-4" /> Fix the serial number
      </button>
    );
  }

  return (
    <form onSubmit={run} className="rounded-lg border border-(--dc-accent)/30 bg-(--dc-accent-soft)/20 p-3">
      <p className="text-sm font-semibold text-gray-900">
        The number the buyer reads off the label
      </p>
      <p className="mt-0.5 text-xs text-gray-600">
        This record says <span className="font-mono font-medium">{currentSerial}</span>. Ask
        them to read theirs a character at a time. If it is a different stove that was
        sold to somebody else, the two records swap and the other buyer gets flagged for
        a call.
      </p>

      <div className="mt-2.5 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-gray-700">Confirmed serial number</span>
          <input
            type="text"
            value={serial}
            onChange={(e) => setSerial(e.target.value.toUpperCase())}
            aria-label="Confirmed serial number"
            placeholder={currentSerial ?? "PRV000000"}
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </label>
        <label className="min-w-0 flex-[2]">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            What they said (optional)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="What they said"
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </label>
      </div>

      {error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || !serial.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          Move this record onto it
        </button>
        <ConfirmDialog
          open={confirming}
          title={`Move this record onto ${serial.trim() || "that stove"}?`}
          description="The record's serial number changes to the one the buyer read out. If another buyer's record already holds that stove, theirs is marked unconfirmed until a caller confirms it with them, and somebody will have to ring them."
          cancelLabel="Leave it"
          actionLabel="Move it"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={perform}
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

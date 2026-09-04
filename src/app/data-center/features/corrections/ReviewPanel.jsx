import { useMemo, useState } from "react";
import { dataCenterCorrections, DataCenterError } from "../../lib/client";
import { byKey } from "./lib/saleFields";
import { Loader2, PhoneCall, PhoneOff, RotateCcw, Undo2 } from "lucide-react";

/**
 * The call centre's verdict.
 *
 * What changed between the episode opening and Sales saving, from the two
 * snapshots the episode carries; the rep's note; then Close (ring again, or
 * nothing to ring) or Send back to Sales again. Slice 3 adds the sale's own
 * history and the recall allowance; this is the door.
 */

const show = (v) => (v == null || v === "" ? "empty" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

export default function ReviewPanel({ saleId, episode, can, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const diff = useMemo(() => {
    const before = episode.before ?? {};
    const after = episode.after ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys]
      .filter((k) => show(before[k]) !== show(after[k]))
      .map((k) => ({ key: k, label: byKey[k]?.label ?? k, before: show(before[k]), after: show(after[k]) }));
  }, [episode]);

  const act = async (fn, label) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
      onDone?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  };

  if (episode.state === "resolved") return null;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">
          {episode.state === "fixed" ? "Review the fix" : "Call centre"}
        </h2>
        <p className="mt-0.5 text-xs text-gray-600">
          {episode.state === "fixed"
            ? `Fixed by ${episode.fixed_by_name ?? "Sales"}${episode.fixed_on_behalf ? ` for ${episode.fixed_on_behalf}` : ""}. Close it, or send it back again.`
            : "Waiting on Sales. Withdraw it if the call centre no longer needs the fix."}
        </p>
      </header>
      <div className="space-y-3 p-4">
        {episode.state === "fixed" && (
          <>
            {diff.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600">
                Nothing on the sale changed between the send-back and the fix. Read the note before closing.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-(--dc-accent-soft) text-left uppercase tracking-wide text-(--dc-accent-strong)">
                    <th className="px-2 py-1 font-semibold">Field</th>
                    <th className="px-2 py-1 font-semibold">Before</th>
                    <th className="px-2 py-1 font-semibold">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diff.map((d) => (
                    <tr key={d.key}>
                      <td className="px-2 py-1 font-medium text-gray-800">{d.label}</td>
                      <td className="px-2 py-1 text-red-800 line-through">{d.before}</td>
                      <td className="px-2 py-1 font-semibold text-(--dc-accent-strong)">{d.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {episode.fix_note && (
              <p className="text-sm text-gray-800">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Sales says</span>
                <br />"{episode.fix_note}"
              </p>
            )}
          </>
        )}
        <div>
          <label htmlFor="review-note" className="block text-xs font-medium uppercase tracking-wide text-gray-600">
            Note for the timeline
          </label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={episode.state === "fixed" ? "Optional. The agent who rings next reads this first." : "Why the call centre is taking it back."}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--dc-accent)/30"
          />
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {episode.state === "fixed" && can.review && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act(() => dataCenterCorrections.review(saleId, "recall", note.trim() || null), "recall")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-(--dc-accent) px-4 text-sm font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              {busy === "recall" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              Close and ring again
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act(() => dataCenterCorrections.review(saleId, "no_recall", note.trim() || null), "no_recall")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--dc-accent)/40 px-4 text-sm font-medium text-(--dc-accent) hover:bg-(--dc-accent-soft) disabled:opacity-50"
            >
              {busy === "no_recall" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
              Close, nothing to ring
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (!note.trim()) {
                  setError("Say what is still wrong; Sales reads this.");
                  return;
                }
                act(() => dataCenterCorrections.review(saleId, "reopen", note.trim()), "reopen");
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {busy === "reopen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Send back to Sales again
            </button>
          </div>
        )}
        {episode.state === "open" && can.withdraw && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act(() => dataCenterCorrections.withdraw(saleId, note.trim() || null), "withdraw")}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "withdraw" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Withdraw the send-back
          </button>
        )}
      </div>
    </section>
  );
}

import { useMemo, useState } from "react";
import { dataCenterCorrections, DataCenterError } from "../../lib/client";
import { dateOf } from "../../lib/when";
import { byKey } from "./lib/saleFields";
import { Loader2, PhoneCall, PhoneOff, RotateCcw, Undo2 } from "lucide-react";

/**
 * The call centre's verdict.
 *
 * What changed between the episode opening and Sales saving, from the two
 * snapshots the episode carries, plus whatever the sales app logged on the
 * sale in that window; the number the call centre heard against the one
 * Sales saved; the rep's note. Then Close (ring again, or nothing to ring) or
 * Send back to Sales again.
 *
 * Closing with "ring again" gives the record a fresh allowance of calls: the
 * pool view subtracts the attempts made before the close.
 */

const show = (v) => (v == null || v === "" ? "empty" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

function PhoneCheck({ check, choice, onChoose }) {
  if (!check || !check.heard) return null;
  if (check.matches) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        Sales saved the number the call centre heard ({check.heard}). The call centre's note of it clears when this closes.
      </p>
    );
  }
  return (
    <fieldset className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-amber-900">Two numbers</legend>
      <p className="text-xs text-amber-900">
        Call centre heard <span className="font-mono font-semibold">{check.heard}</span>. Sales saved{" "}
        <span className="font-mono font-semibold">{check.saved ?? "nothing"}</span>. Say which one stands.
      </p>
      <div className="mt-2 space-y-1.5">
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name="phone-choice"
            value="use_saved"
            checked={choice === "use_saved"}
            onChange={() => onChoose("use_saved")}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Use what Sales saved
            <span className="block text-xs text-gray-600">The call centre's number is cleared; the next call dials the saved one.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name="phone-choice"
            value="keep_corrected"
            checked={choice === "keep_corrected"}
            onChange={() => onChoose("keep_corrected")}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Keep the call centre's number
            <span className="block text-xs text-gray-600">The next call dials what the buyer told the agent.</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

function History({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">The sales app also logged</p>
      <ul className="mt-1 space-y-1.5">
        {rows.map((h, i) => {
          const changes = h.field_changes && typeof h.field_changes === "object"
            ? Object.entries(h.field_changes).filter(([, v]) => v && typeof v === "object" && ("old_value" in v || "new_value" in v))
            : [];
          return (
            <li key={`${h.performed_at}-${i}`} className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
              <span className="font-medium text-gray-900">{h.action_description}</span>
              <span className="text-gray-500">
                {" "}
                {dateOf(h.performed_at, "")}
                {h.performed_by_name ? ` by ${h.performed_by_name}` : ""}
              </span>
              {changes.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {changes.map(([k, v]) => (
                    <li key={k}>
                      <span className="font-medium">{byKey[k]?.label ?? k}</span>: {show(v.old_value)}, now {show(v.new_value)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ReviewPanel({ saleId, episode, can, history = [], phoneCheck = null, onDone }) {
  const [note, setNote] = useState("");
  const [phoneChoice, setPhoneChoice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const diff = useMemo(() => {
    const before = episode.before ?? {};
    const after = episode.after ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys]
      // A key the older snapshot never carried is the snapshot growing, not a
      // change somebody made; it is compared only once both sides have it.
      .filter((k) => k in before)
      .filter((k) => show(before[k]) !== show(after[k]))
      .map((k) => ({ key: k, label: byKey[k]?.label ?? k, before: show(before[k]), after: show(after[k]) }));
  }, [episode]);

  const needsPhoneChoice = Boolean(phoneCheck?.heard) && phoneCheck?.matches === false;

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

  const close = (outcome) => {
    if (needsPhoneChoice && !phoneChoice) {
      setError("Say which number stands before closing.");
      return;
    }
    act(() => dataCenterCorrections.review(saleId, outcome, note.trim() || null, phoneChoice), outcome);
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
            <History rows={history} />
            <PhoneCheck check={phoneCheck} choice={phoneChoice} onChoose={setPhoneChoice} />
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
              onClick={() => close("recall")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-(--dc-accent) px-4 text-sm font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              {busy === "recall" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              Close and ring again
            </button>
            <p className="-mt-1 px-1 text-[11px] text-gray-500">
              The record goes back into the pool with a fresh allowance of calls.
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => close("no_recall")}
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

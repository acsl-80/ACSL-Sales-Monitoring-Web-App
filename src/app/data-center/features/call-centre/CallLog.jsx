import { useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PhoneCall } from "lucide-react";
import { whenOf } from "../../lib/when";

/**
 * The calls on a record, and the next one being logged.
 *
 * Attempts are rows, so a fourth call is a click and not a migration. The
 * outcome list comes from the registry (`call_outcome`); two of its values
 * change the form: "something else" makes the note compulsory, and a callback
 * asks for a time (Phase 26, C4). What is half-typed here belongs to one
 * record, so the editor mounts this with `key={saleId}` and a new record
 * starts clean.
 *
 * `onLog({ outcomeId, note, callbackAt })` writes the attempt and answers true
 * once it is on the record; a refused attempt keeps what was typed.
 */
export default function CallLog({ attempts, outcomes, canEdit, saving, onLog }) {
  const [nextOutcome, setNextOutcome] = useState("");
  const [nextNote, setNextNote] = useState("");
  /** When the buyer asked to be rung again; only sent with a callback outcome. */
  const [callbackAt, setCallbackAt] = useState("");

  /*
   * "Something else" is the outcome that has to be typed out.
   *
   * The nine seeded outcomes came from a closed list, and the July data shows
   * what an agent does when the call does not fit one: they invent a tenth and
   * type it into a constrained column. RESPONDED, REPONDED and NO PHONE NUMBER
   * all arrived that way. Giving them one place to say what happened is what
   * stops the next three inventions, so when this outcome is picked the note
   * stops being optional.
   */
  const picked = outcomes.find((o) => o.id === nextOutcome)?.value;
  const otherIsPicked = picked === "other";
  const callbackIsPicked = picked === "callback_requested";
  // An attempt needs an outcome; "something else" needs the words as well.
  const canLog = Boolean(nextOutcome) && (!otherIsPicked || nextNote.trim().length > 0);

  /** Quick times for a callback, in the browser's local clock. */
  const quickCallback = (kind) => {
    const d = new Date();
    if (kind === "hour") d.setHours(d.getHours() + 1, 0, 0, 0);
    if (kind === "evening") { d.setHours(17, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); }
    if (kind === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    const pad = (n) => String(n).padStart(2, "0");
    setCallbackAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  const log = async () => {
    // Cleared only once the attempt is on the record; a refused attempt keeps
    // what was typed.
    const ok = await onLog({
      outcomeId: nextOutcome,
      note: nextNote,
      callbackAt: callbackIsPicked && callbackAt ? callbackAt : null,
    });
    if (ok) {
      setNextOutcome("");
      setNextNote("");
      setCallbackAt("");
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Calls ({attempts.length})
        </h3>
        {canEdit && (
          <div className="flex items-center gap-2">
            {/* State, not the DOM. This read the select back through
                getElementById, which worked only while exactly one
                editor existed on the page. */}
            <label htmlFor="dc-next-outcome" className="sr-only">
              Outcome of this call
            </label>
            <div className="min-w-0 flex-1 sm:flex-none sm:min-w-[12rem]">
              <SearchableSelect
                id="dc-next-outcome"
                ariaLabel="Outcome of this call"
                value={nextOutcome}
                onChange={setNextOutcome}
                placeholder="Outcome..."
                searchPlaceholder="Type part of an outcome"
                emptyLabel="No outcome matches that"
                options={outcomes.map((o) => ({ value: o.id, label: o.label }))}
              />
            </div>
            <button
              type="button"
              disabled={saving || !canLog}
              onClick={log}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              <PhoneCall className="h-3 w-3" /> Log call
            </button>
          </div>
        )}
      </div>

      {canEdit && callbackIsPicked && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-(--dc-brief-place) bg-(--dc-brief-place-soft)/40 p-3" data-callback-time>
          <label htmlFor="dc-callback-at" className="text-xs font-semibold uppercase tracking-wide text-(--dc-brief-place)">Call back at</label>
          <input
            id="dc-callback-at"
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
          {[["hour", "in 1 hour"], ["evening", "after 17:00"], ["tomorrow", "tomorrow 09:00"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => quickCallback(k)} className="rounded-full border border-(--dc-brief-place) bg-white px-2.5 py-0.5 text-xs font-semibold text-(--dc-brief-place)">
              {label}
            </button>
          ))}
          <span className="text-xs text-gray-600">Goes on the call, so your queue puts it first when the time comes.</span>
        </div>
      )}
      {canEdit && otherIsPicked && (
        <div className="mb-3 rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/30 p-3">
          <label
            htmlFor="dc-next-note"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-(--dc-accent-strong)"
          >
            What happened on this call?
          </label>
          <textarea
            id="dc-next-note"
            rows={2}
            value={nextNote}
            onChange={(e) => setNextNote(e.target.value)}
            placeholder="Say what the outcome was, since it is not one of the listed ones"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </div>
      )}

      {attempts.length === 0 ? (
        <p className="text-sm text-gray-500">No calls logged yet.</p>
      ) : (
        <ul className="space-y-1">
          {attempts.map((a) => (
            <li key={a.id} className="flex items-baseline gap-2 text-sm text-gray-700">
              <span className="w-6 shrink-0 text-xs font-semibold text-gray-400">
                #{a.attempt_no}
              </span>
              <span className="shrink-0 text-xs text-gray-500">
                {whenOf(a.attempted_at)}
              </span>
              <span className="min-w-0 flex-1 truncate">{a.outcome ?? "no outcome recorded"}</span>
              {a.answered_by && (
                <span className="shrink-0 text-xs text-gray-500">{a.answered_by}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

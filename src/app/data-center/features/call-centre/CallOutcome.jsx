import { SearchableSelect } from "@/components/ui/searchable-select";
import { whenOf } from "../../lib/when";
import { OUTCOME_ORDER, OUTCOME_WORDS, OUTCOME_PILL } from "../../lib/outcome";

/**
 * This call: its outcome, the note when the outcome needs words, the callback
 * time when the buyer asked for one, and the verdict the record ends up with.
 *
 * Phase 28, D42 to D44. The outcome list is the registry's `call_outcome`,
 * now with Verified and Partly verified at the top, and the verdict follows
 * the outcome through `call_centre.outcome_verdict`. The pills stay: they show
 * the verdict the outcome implies, and clicking one overrides it. Nothing here
 * writes; Save call carries `attempt` and the verdict together.
 *
 * Controlled by the editor: `attempt` is `{ outcomeId, note, callbackAt,
 * clientKey }`, `verdict` is what the record will read after the save, and
 * `verdictExplicit` says whether the agent set it by hand.
 */
const VERDICTS = OUTCOME_ORDER.map((value) => ({ value, label: OUTCOME_WORDS[value], tone: OUTCOME_PILL[value] }));

export default function CallOutcome({
  attempts, outcomes, canEdit, saving,
  attempt, onAttemptChange,
  verdict, verdictExplicit, verdictDerived, onVerdict,
  prompt = false,
}) {
  const picked = outcomes.find((o) => o.id === attempt.outcomeId)?.value;
  const otherIsPicked = picked === "other";
  const callbackIsPicked = picked === "callback_requested";

  /** Quick times for a callback, in the browser's local clock. */
  const quickCallback = (kind) => {
    const d = new Date();
    if (kind === "hour") d.setHours(d.getHours() + 1, 0, 0, 0);
    if (kind === "evening") { d.setHours(17, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); }
    if (kind === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    const pad = (n) => String(n).padStart(2, "0");
    onAttemptChange({ ...attempt, callbackAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` });
  };

  return (
    <div className="space-y-3" data-call-outcome>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">This call</h3>
        {canEdit && (
          <div className="flex min-w-0 items-center gap-2 sm:min-w-[20rem]">
            <label htmlFor="dc-next-outcome" className="sr-only">Outcome of this call</label>
            <div className={`min-w-0 flex-1 ${prompt ? "rounded-md ring-2 ring-(--dc-accent)/50" : ""}`}>
              <SearchableSelect
                id="dc-next-outcome"
                ariaLabel="Outcome of this call"
                value={attempt.outcomeId}
                onChange={(next) => onAttemptChange({ ...attempt, outcomeId: next })}
                placeholder="Outcome of this call"
                searchPlaceholder="Type part of an outcome"
                emptyLabel="No outcome matches that"
                disabled={saving}
                options={outcomes.map((o) => ({ value: o.id, label: o.label }))}
              />
            </div>
          </div>
        )}
      </div>

      {canEdit && callbackIsPicked && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-(--dc-brief-place) bg-(--dc-brief-place-soft)/40 p-3" data-callback-time>
          <label htmlFor="dc-callback-at" className="text-xs font-semibold uppercase tracking-wide text-(--dc-brief-place)">Call back at</label>
          <input
            id="dc-callback-at"
            type="datetime-local"
            value={attempt.callbackAt ?? ""}
            onChange={(e) => onAttemptChange({ ...attempt, callbackAt: e.target.value })}
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
        <div className="rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/30 p-3">
          <label htmlFor="dc-next-note" className="mb-1 block text-xs font-medium uppercase tracking-wide text-(--dc-accent-strong)">
            What happened on this call?
          </label>
          <textarea
            id="dc-next-note"
            rows={2}
            value={attempt.note ?? ""}
            onChange={(e) => onAttemptChange({ ...attempt, note: e.target.value })}
            placeholder="Say what the outcome was, since it is not one of the listed ones"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </div>
      )}

      {/* The verdict: what the record reads after this save. Everything
          downstream groups by it, so it stays its own control. */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Verification outcome</h3>
        <div className="flex flex-wrap items-center gap-2">
          {VERDICTS.map((o) => {
            const active = verdict === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={!canEdit || saving}
                aria-pressed={active}
                onClick={() => onVerdict(o.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active ? o.tone + " ring-2 ring-offset-1 ring-(--dc-primary)/40" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                } disabled:opacity-50`}
              >
                {o.label}
              </button>
            );
          })}
          {canEdit && (
            <span className="text-xs text-gray-500" data-verdict-source>
              {verdictExplicit
                ? "Set by you."
                : verdictDerived
                  ? "Set by the outcome. Click a pill to override."
                  : "Set by the outcome you pick, or click a pill."}
            </span>
          )}
        </div>
      </div>

      {/* Earlier calls on this record. */}
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Earlier calls ({attempts.length})</h3>
        {attempts.length === 0 ? (
          <p className="text-sm text-gray-500">No calls logged yet.</p>
        ) : (
          <ul className="space-y-1">
            {attempts.map((a) => (
              <li key={a.id} className="flex items-baseline gap-2 text-sm text-gray-700">
                <span className="w-6 shrink-0 text-xs font-semibold text-gray-400">#{a.attempt_no}</span>
                <span className="shrink-0 text-xs text-gray-500">{whenOf(a.attempted_at)}</span>
                <span className="min-w-0 flex-1 truncate">{a.outcome ?? "no outcome recorded"}</span>
                {a.source === "sheet" && <span className="shrink-0 text-xs text-gray-500">from the call sheet</span>}
                {a.source === "reconciled" && <span className="shrink-0 text-xs text-gray-500">from the saved verdict</span>}
                {a.answered_by && <span className="shrink-0 text-xs text-gray-500">{a.answered_by}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

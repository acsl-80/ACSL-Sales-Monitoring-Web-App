import Link from "@/compat/Link";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Loader2, PenLine } from "lucide-react";
import SaveCallButton from "./SaveCallButton";
import { whenOf } from "../../lib/when";

/**
 * The bottom of the call form: Finish later and Save call, the quiet draft
 * line, the prompt when a save arrives with no outcome (D44), and after a
 * save the way on (Phase 26, C4).
 *
 * `prompt` is set by the editor when Save call was pressed with changes but
 * no outcome: the band asks for one, with "No call was made, just save" as
 * the way through. `handoff` is `{ next }` once a save lands.
 */
export default function SaveFooter({
  canEdit, saving, loading, draftBusy, draftSavedAt,
  prompt, outcomes, attempt, onAttemptChange, onSaveAnyway, onDismissPrompt,
  handoff, onBack, allHref, onClose, onNext, onKeepAndClose, onSave,
}) {
  return (
    <>
      {prompt && canEdit && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-3 border-t border-(--dc-accent)/35 bg-(--dc-accent-soft)/35 px-5 py-3"
          data-outcome-prompt
          role="status"
        >
          <p className="text-sm font-semibold text-gray-900">Which outcome did this call have?</p>
          <div className="min-w-[14rem] flex-1 sm:max-w-xs">
            <SearchableSelect
              ariaLabel="Outcome of this call, before saving"
              value={attempt.outcomeId}
              onChange={(next) => onAttemptChange({ ...attempt, outcomeId: next })}
              placeholder="Pick what happened"
              searchPlaceholder="Type part of an outcome"
              emptyLabel="No outcome matches that"
              options={outcomes.map((o) => ({ value: o.id, label: o.label }))}
            />
          </div>
          <button
            type="button"
            onClick={onSaveAnyway}
            className="text-sm font-semibold text-(--dc-accent) underline underline-offset-2 hover:text-(--dc-accent-strong)"
          >
            No call was made, just save
          </button>
          <button type="button" onClick={onDismissPrompt} className="text-xs text-gray-500 hover:text-gray-700">
            Back to the form
          </button>
        </div>
      )}
      {handoff && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-(--dc-brief-who) bg-white px-5 py-3 shadow-[inset_0_0_0_3px_var(--dc-brief-who-soft)]" data-handoff role="status">
          <p className="min-w-0 flex-1 text-sm text-gray-800">
            <span className="font-semibold">Saved</span>{" · "}
            {handoff.next
              ? <>Next for you: <span className="font-medium">{handoff.next.label}</span>.{handoff.next.remaining > 0 ? ` ${handoff.next.remaining} more after that.` : ""}</>
              : "That was the last record assigned to you. Your manager hands out more from the control centre."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onBack} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Back</button>
            <Link href={allHref} onClick={() => onClose?.()} className="rounded-md border border-(--dc-brief-stove) px-3 py-1.5 text-sm font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)">See all assigned</Link>
            {handoff.next && onNext && (
              <button type="button" onClick={() => onNext(handoff.next.saleId)} className="rounded-lg bg-(image:--dc-fig-transferred) px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110">
                Next record
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-(--dc-surface-muted) px-5 py-3">
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          {canEdit
            ? "Every change is recorded against your name."
            : "You have view access, so this record is read only."}
          {/*
            The draft, said quietly. An agent needs to know their typing is
            being kept, or they will not trust the form enough to leave it
            half-finished, which is the whole point. Relative time through
            whenOf, like every other date in the module.
          */}
          {canEdit && draftBusy && (
            <span className="inline-flex items-center gap-1 text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" /> keeping...
            </span>
          )}
          {canEdit && !draftBusy && draftSavedAt && (
            <span className="inline-flex items-center gap-1 text-amber-700" data-draft-saved>
              <PenLine className="h-3 w-3" /> Draft saved {whenOf(draftSavedAt)}
            </span>
          )}
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Closing deliberately writes the draft now rather than in two
              seconds' time, so "I will come back to this" and "the line just
              dropped" both end the same way.
            */}
            <button
              type="button"
              disabled={saving || loading}
              onClick={onKeepAndClose}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <PenLine className="h-4 w-4" /> Finish later
            </button>
            <SaveCallButton where="footer" saving={saving} disabled={saving || loading} onClick={onSave} />
          </div>
        )}
      </div>
    </>
  );
}

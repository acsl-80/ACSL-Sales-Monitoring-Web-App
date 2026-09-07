import Link from "@/compat/Link";
import { Loader2, PenLine, Save } from "lucide-react";

/**
 * The bottom of the call form: Finish later and Save, the quiet autosave
 * line, and after Save the way on (Phase 26, C4).
 *
 * `handoff` is set by the editor once a save lands: `{ next }` where `next`
 * names the record that follows in the agent's own calling order, or is null
 * when nothing is left. Back clears it; See all assigned leaves the form for
 * `allHref`; Next record hands the next sale id to `onNext`.
 */
export default function SaveFooter({
  canEdit, saving, loading, draftBusy, draftSavedAt,
  handoff, onBack, allHref, onClose, onNext, onKeepAndClose, onSave,
}) {
  return (
    <>
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
              <button type="button" onClick={() => onNext(handoff.next.saleId)} className="rounded-md bg-(image:--dc-fig-sold) px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110">
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
            The autosave, said quietly.

            An agent needs to know their typing is being kept, or they will
            not trust the form enough to leave it half-finished - which is
            the whole point. Quiet, because it must not compete for attention
            during a live call.
          */}
          {canEdit && draftBusy && (
            <span className="inline-flex items-center gap-1 text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" /> keeping...
            </span>
          )}
          {canEdit && !draftBusy && draftSavedAt && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <PenLine className="h-3 w-3" /> kept, not saved
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
            <button
              type="button"
              disabled={saving || loading}
              onClick={onSave}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        )}
      </div>
    </>
  );
}

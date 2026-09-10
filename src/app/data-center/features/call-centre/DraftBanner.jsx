import { Loader2, PenLine, RotateCcw, AlertTriangle } from "lucide-react";
import { whenOf } from "../../lib/when";
import ConfirmDialog from "../../components/ConfirmDialog";

/**
 * What somebody left half-finished here, and the one way to get rid of it.
 *
 * Applied to the form already rather than offered, because an agent who typed
 * four answers and lost the call expects to find them, not to be asked whether
 * they meant it. The banner says whose answers these are and when. Amber, not
 * green: nothing here has reached the call record.
 */
export function DraftBanner({ draft, recordVersion, canEdit, busy, onClear }) {
  if (!draft) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2.5" data-draft-banner>
      <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1 text-sm text-amber-900">
        <span className="font-semibold">
          {draft.saved_by_me
            ? "You started this and did not finish."
            : `${draft.saved_by_name ?? "Somebody"} started this and did not finish.`}
        </span>{" "}
        Their answers are in the form below, from {whenOf(draft.saved_at)}. Nothing has been saved to the record yet.
        {draft.base_version != null && recordVersion != null && draft.base_version !== recordVersion && (
          <span className="mt-1 block font-semibold">
            The record has been saved by somebody else since this was typed. Check each answer
            against what they entered before you save.
          </span>
        )}
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          Clear it and start again
        </button>
      )}
    </div>
  );
}

/** Finish later could not keep the typing; closing now would lose it. */
export function KeepFailedBand({ reason, onCloseAnyway }) {
  if (!reason) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <p className="min-w-0 flex-1 text-sm text-red-900">
        Your answers could not be kept: {reason}. Save the record, or close anyway and lose what you typed.
      </p>
      <button
        type="button"
        onClick={onCloseAnyway}
        className="inline-flex shrink-0 items-center rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100"
      >
        Close anyway
      </button>
    </div>
  );
}

/** The question before a draft is thrown away. */
export function ClearDraftDialog({ open, draft, busy, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      open={open}
      title="Clear this unfinished form?"
      description={`${draft?.saved_by_name ? `${draft.saved_by_name}'s` : "The"} unsaved answers go, and the form starts again from the saved record. Nothing already saved changes.`}
      cancelLabel="Keep the answers"
      actionLabel="Clear it"
      destructive
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

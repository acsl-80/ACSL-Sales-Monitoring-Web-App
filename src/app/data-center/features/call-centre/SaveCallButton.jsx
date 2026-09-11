import { Loader2, PhoneCall } from "lucide-react";

/**
 * Save call, top and bottom of the form, one handler (Phase 28, D42). The
 * save gradient the module gives every "save" verb; `where` names which of
 * the two it is, for a test to pick one without a strict-mode clash.
 */
export default function SaveCallButton({ where, saving, disabled, onClick, compact = false }) {
  return (
    <button
      type="button"
      data-save-call={where}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-(image:--dc-fig-sold) font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50 ${
        compact ? "px-3 py-1.5 text-sm" : "px-4 py-1.5 text-sm"
      }`}
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
      Save call
    </button>
  );
}

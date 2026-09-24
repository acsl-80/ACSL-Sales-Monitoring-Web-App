// Status labels and colours for the Change Control screens.
//
// The list action gives a `status_label` and `status_tone` for a request's
// own current status, but a status-change entry in its thread is passed
// through as a bare `status_to` key (see change-request-intake's header,
// which does not carry a label or tone for it). This is the one place the
// seven statuses named in that contract are written down, so a thread entry
// can still show a proper chip.
//
// The tone for each status is read off the order the contract lists them in
// ("status is one of new, needs_info, ... ; status_tone is one of new, info,
// ...") — both lists have seven entries in the same order, so position
// matches them up. If that pairing is ever wrong, the effect is a
// mis-coloured chip on a status-change note, nothing else.
export const STATUS_META: Record<string, { label: string; tone: string }> = {
  new: { label: "New", tone: "new" },
  needs_info: { label: "Needs info", tone: "info" },
  not_started: { label: "Not started", tone: "queued" },
  in_progress: { label: "In progress", tone: "progress" },
  fixed: { label: "Fixed", tone: "fixed" },
  still_open: { label: "Still open", tone: "reopen" },
  closed: { label: "Closed", tone: "closed" },
};

// Solid, sharp-contrast classes (not pastel badges), so a status reads at a
// glance in a table or a thread. Same seven tone keys, same colours, as the
// ERP's own change-control tones, so a status looks the same in both apps.
const TONE_CLASSES: Record<string, string> = {
  new: "bg-blue-600 text-white",
  info: "bg-amber-500 text-white",
  queued: "bg-slate-500 text-white",
  progress: "bg-indigo-600 text-white",
  fixed: "bg-teal-600 text-white",
  reopen: "bg-orange-600 text-white",
  closed: "bg-green-600 text-white",
};

const FALLBACK_TONE_CLASSES = "bg-gray-500 text-white";

export function toneClasses(tone: string | null | undefined): string {
  if (!tone) return FALLBACK_TONE_CLASSES;
  return TONE_CLASSES[tone] ?? FALLBACK_TONE_CLASSES;
}

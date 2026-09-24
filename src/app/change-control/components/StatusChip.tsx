import { toneClasses } from "../lib/status";

type StatusChipProps = {
  label: string;
  tone?: string | null;
};

/**
 * A request's own status already carries its label and tone from the server
 * (`status_label`, `status_tone`) — this just renders them. A thread's
 * status-change entry only has a bare `status_to` key, so its caller looks
 * that up first (lib/status.ts's STATUS_META) and passes the result in here.
 */
export default function StatusChip({ label, tone }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${toneClasses(tone)}`}
    >
      {label}
    </span>
  );
}

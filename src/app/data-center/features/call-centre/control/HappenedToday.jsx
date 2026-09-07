import { useState } from "react";
import Link from "@/compat/Link";
import CallRecordEditor from "../CallRecordEditor";

/**
 * What happened (Phase 26, C2): the day's events as words, newest first, ten
 * of them, and All activity for the rest. Replaces the assignment log as a
 * section: the log was one row per record ever handed out, which mixed calls
 * made with calls still to come. This is a feed of things that happened, each
 * tagged by kind, and it is the same read the board's marks come from, so the
 * two never disagree.
 */
export const KIND = {
  call: { text: "call", cls: "bg-(--dc-brief-who-soft) text-(--dc-brief-who)" },
  handed_out: { text: "handed out", cls: "bg-(--dc-sev-ok-soft) text-(--dc-sev-ok)" },
  reclaimed: { text: "reclaimed", cls: "bg-(--dc-brief-history-soft) text-(--dc-brief-history)" },
  sent_back: { text: "sent back", cls: "bg-(--dc-brief-history-soft) text-(--dc-brief-history)" },
  reviewed: { text: "reviewed", cls: "bg-(--dc-brief-place-soft) text-(--dc-brief-place)" },
};

export const OUTCOME_TONE = (value) =>
  value === "callback_requested"
    ? "bg-(--dc-brief-place-soft) text-(--dc-brief-place)"
    : ["unreachable", "phone_unanswered", "wrong_number", "customer_hung_up"].includes(value)
    ? "bg-(--dc-sev-critical-soft) text-(--dc-sev-critical)"
    : "bg-(--dc-brief-who-soft) text-(--dc-brief-who)";

export function KindPill({ kind }) {
  const k = KIND[kind] ?? KIND.call;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${k.cls}`} data-kind={kind}>{k.text}</span>;
}

export function clockOf(iso, tz) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
}

/** One event, said as a sentence a manager would say. */
export function sentenceOf(r) {
  const who = r.actor_name ?? "Somebody";
  const stove = r.stove_serial_no ? `${r.stove_serial_no}${r.end_user_name ? `, ${r.end_user_name}` : ""}` : "a record";
  const partner = r.partner_name ? `, ${r.partner_name}` : "";
  const d = r.detail ?? {};
  switch (r.kind) {
    case "call": {
      const nth = d.attempt_no ? `${d.attempt_no}${["st", "nd", "rd"][d.attempt_no - 1] ?? "th"} try` : "a call";
      return `${who} logged ${nth} on ${stove}${partner}${d.outcome_label ? `: ${d.outcome_label}` : ""}`;
    }
    case "handed_out":
      return `${who} handed ${d.size ?? ""} records to ${d.assigned_to_name ?? "an agent"}${partner}${d.override_reason ? ` (over capacity: ${d.override_reason})` : ""}`;
    case "reclaimed":
      return `${who} reclaimed a batch of ${d.size ?? ""} from ${d.assigned_to_name ?? "an agent"}${partner}${d.reason ? `, ${d.reason}` : ""}`;
    case "sent_back":
      return `${who} sent ${stove}${partner} back to Sales${d.reason ? `: ${d.reason}` : ""}`;
    case "reviewed":
      return `${who} reviewed the fix on ${stove}${partner}${d.review_outcome === "recall" ? ", to be rung again" : d.review_outcome === "no_recall" ? ", closed" : ""}`;
    default:
      return `${who}: ${r.kind}`;
  }
}

export default function HappenedToday({ activity, board, canEdit, dayLabel }) {
  const [openSale, setOpenSale] = useState(null);
  const rows = activity?.rows ?? [];
  const tz = board?.tz ?? "Africa/Lagos";
  const from = board ? (board.range === "week" ? board.days[0] : board.day) : null;
  const allHref = from ? `/data-center/call-centre/activity?from=${from}&to=${board.day}` : "/data-center/call-centre/activity";

  return (
    <section aria-labelledby="cc-happened" className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-brief-history) bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-brief-history-soft)/30 px-4 py-2.5">
        <h2 id="cc-happened" className="text-sm font-semibold text-gray-900">What happened {dayLabel}</h2>
        <span className="text-xs text-gray-600">calls concluded, hand-outs, reclaims and send-backs, newest first</span>
        {board ? (
          <Link
            href={allHref}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-(--dc-fig-transferred) px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:brightness-110"
          >
            All activity
          </Link>
        ) : (
          <span className="ml-auto inline-flex items-center rounded-md bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">All activity</span>
        )}
      </header>
      <ul className="divide-y divide-gray-100" data-feed>
        {!activity && <li className="px-4 py-4 text-center text-xs text-gray-500">Loading the day...</li>}
        {activity && rows.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-gray-500">Nothing happened {dayLabel}. Calls, hand-outs and send-backs appear here the moment they do.</li>
        )}
        {rows.map((r, i) => (
          <li key={`${r.at}-${r.kind}-${r.sale_id ?? r.batch_id ?? i}`} className="flex items-start gap-3 px-4 py-2 text-sm">
            <span className="w-12 shrink-0 font-mono text-xs text-gray-500">{clockOf(r.at, tz)}</span>
            <KindPill kind={r.kind} />
            <span className="min-w-0 flex-1 text-gray-800">{sentenceOf(r)}</span>
            {r.kind === "call" && r.outcome_value && (
              <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex ${OUTCOME_TONE(r.outcome_value)}`}>{r.detail?.outcome_label ?? r.outcome_value}</span>
            )}
            {r.sale_id && (
              <button
                type="button"
                onClick={() => setOpenSale(r.sale_id)}
                className="shrink-0 rounded-md border border-(--dc-brief-stove) px-2 py-0.5 text-xs font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)"
              >
                Open
              </button>
            )}
          </li>
        ))}
      </ul>
      {activity && activity.total > rows.length && (
        <p className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-600">{rows.length} of {activity.total.toLocaleString()} events · the rest under All activity.</p>
      )}
      {openSale && <CallRecordEditor saleId={openSale} canEdit={canEdit} onClose={() => setOpenSale(null)} />}
    </section>
  );
}

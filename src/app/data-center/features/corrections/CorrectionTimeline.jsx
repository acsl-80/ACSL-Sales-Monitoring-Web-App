import { whenOf } from "../../lib/when";

/**
 * The episodes, newest first. The rows are the timeline: reopening starts the
 * next one rather than rewriting the last, so nothing here is derived.
 */

const OUTCOME_WORD = {
  recall: "closed, to be rung again",
  no_recall: "closed, nothing to ring",
  withdrawn: "withdrawn by the call centre",
  reopened: "sent back to Sales again",
};

function Row({ dot, children }) {
  return (
    <li className="flex gap-2.5 text-sm">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="text-gray-800">{children}</span>
    </li>
  );
}

export default function CorrectionTimeline({ episodes }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">Timeline</h2>
      </header>
      <ol className="space-y-3 p-4">
        {episodes.map((e) => (
          <li key={e.id} className="space-y-1.5">
            {episodes.length > 1 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Episode {e.seq}</p>
            )}
            <ol className="space-y-1.5">
              <Row dot="bg-red-500">
                <strong>Sent back</strong> {whenOf(e.opened_at, "")}
                {e.opened_by_name ? ` by ${e.opened_by_name}` : ""}: {e.reason_label ?? "no reason given"}
                {e.note ? ` ("${e.note}")` : ""}
              </Row>
              <Row dot={e.current_rep_user_id ? "bg-(--dc-accent)" : "bg-amber-500"}>
                <strong>Routed</strong> to{" "}
                {e.rep_account_name
                  ? `${e.rep_account_name}${e.via_delegate ? " (delegate)" : ""}`
                  : "the standing recipients; the rep has no account"}
                {e.sales_rep ? ` (rep on the transfer: ${e.sales_rep})` : ""}
              </Row>
              {e.claimed_at && (
                <Row dot="bg-(--dc-accent)">
                  <strong>Taken</strong> by {e.assigned_to_name ?? "somebody"} {whenOf(e.claimed_at, "")}
                </Row>
              )}
              {e.fixed_at ? (
                <Row dot="bg-amber-500">
                  <strong>Fixed</strong> {whenOf(e.fixed_at, "")} by {e.fixed_by_name ?? "Sales"}
                  {e.fixed_on_behalf ? ` for ${e.fixed_on_behalf}` : ""}
                  {e.fix_note ? ` ("${e.fix_note}")` : ""}
                </Row>
              ) : (
                <Row dot="bg-gray-300"><span className="text-gray-400">Fixed, awaiting review</span></Row>
              )}
              {e.reviewed_at ? (
                <Row dot="bg-(--dc-accent)">
                  <strong>{e.review_outcome === "withdrawn" ? "Withdrawn" : "Reviewed"}</strong> {whenOf(e.reviewed_at, "")}
                  {e.reviewed_by_name ? ` by ${e.reviewed_by_name}` : ""}: {OUTCOME_WORD[e.review_outcome] ?? e.review_outcome}
                  {e.review_note ? ` ("${e.review_note}")` : ""}
                </Row>
              ) : (
                <Row dot="bg-gray-300"><span className="text-gray-400">Closed</span></Row>
              )}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}

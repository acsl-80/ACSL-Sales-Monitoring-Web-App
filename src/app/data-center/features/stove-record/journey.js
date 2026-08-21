/**
 * The seven things that can have happened to a stove, in the order they happen.
 *
 * Kept apart from the component because it is the module's reconciliation
 * funnel restated for one stove, and two places already depend on that funnel
 * being the same everywhere: the partner scorecards count exactly these stages
 * across a batch, and the dashboard rolls those up again. A stove page that
 * invented its own stage names would be a third definition, and the first
 * question anybody asked would be why the page and the scorecard disagree.
 *
 * Every stage answers with a date where one exists. "Done, at some unknown
 * time" is the honest answer for the two the system never timestamped, and
 * saying so is better than borrowing a neighbouring date and implying it.
 */

/** Reached, not reached, or reached and gone wrong. */
export const REACHED = "reached";
export const WAITING = "waiting";
export const TROUBLE = "trouble";

const at = (v) => (v ? new Date(v).toLocaleDateString() : null);

export function journeyOf({ stove, sale, enrichment, provenance, consignment, attempts }) {
  const s = stove ?? {};
  const committed = (provenance ?? []).find(
    (p) => p.status === "committed" || p.confirmed_at,
  );
  const anyImport = (provenance ?? [])[0] ?? null;
  const received = (consignment ?? [])[0] ?? null;
  const calls = attempts?.length ?? Number(s.attempt_count ?? 0);
  const outcome = enrichment?.verification_outcome ?? s.verification_outcome ?? null;

  return [
    {
      key: "issued",
      title: "Issued",
      state: REACHED,
      when: null,
      // The ERP made the serial; there is no date on that row, and inventing
      // one from the transfer would say the stove was built the day it shipped.
      detail: s.factory ? `built at ${s.factory}` : "in the stove register",
    },
    {
      key: "transferred",
      title: "Transferred",
      state: s.transaction_id ? REACHED : WAITING,
      when: at(s.transfer_sales_date ?? s.sales_date),
      detail: s.partner_name
        ? `to ${s.partner_name}`
        : "not yet sent to a partner",
    },
    {
      key: "received",
      title: "Paper back",
      state: received ? REACHED : WAITING,
      when: at(received?.received_at),
      detail: received
        ? `${received.received_count} record${received.received_count === 1 ? "" : "s"} logged in`
        : "no consignment logged for this transfer",
    },
    {
      key: "sold",
      title: "Sold",
      state: s.sale_id ? REACHED : WAITING,
      when: at(sale?.sales_date ?? s.sales_date),
      detail: sale?.end_user_name ?? s.end_user_name ?? "still available stock",
    },
    {
      key: "digitalised",
      title: "Typed up",
      state: committed ? REACHED : anyImport ? TROUBLE : s.sale_id ? REACHED : WAITING,
      when: at(committed?.confirmed_at ?? anyImport?.uploaded_at),
      detail: committed
        ? committed.source === "manual"
          ? "typed at the bench"
          : (committed.filename ?? "from a file")
        : anyImport
          ? `held at the import: ${anyImport.status}`
          : s.sale_id
            ? "entered in the sales app, not from paper"
            : "nothing to type up yet",
    },
    {
      key: "called",
      title: "Called",
      state: calls > 0 ? REACHED : s.sale_id ? WAITING : WAITING,
      when: at(enrichment?.last_attempt_at ?? s.last_attempt_at),
      detail:
        calls > 0
          ? `${calls} call${calls === 1 ? "" : "s"} made`
          : s.agent_name
            ? `with ${s.agent_name}, not yet called`
            : "not assigned to anybody",
    },
    {
      key: "verified",
      title: "Verified",
      state:
        outcome === "fully_verified"
          ? REACHED
          : outcome && outcome !== "not_verified"
            ? TROUBLE
            : WAITING,
      when: null,
      detail: outcome ? outcome.replace(/_/g, " ") : "nothing concluded",
    },
  ];
}

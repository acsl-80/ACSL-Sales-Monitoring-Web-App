/**
 * Where every cell on the Analysis page opens to.
 *
 * One map, in one file, because a drill built inline in each chart is how a
 * chart ends up sending you somewhere that does not mean what the axis said.
 * The rule this file exists to keep: the filter applied on the far side must
 * describe the same population as the cell that was clicked, or the cell says
 * so instead of pretending.
 *
 * Drill-through is a URL, never component state, so back restores the page and
 * a narrowed table can be sent to somebody as a link.
 */

/**
 * Leak reasons that have an exact filter on the call queue.
 *
 * The ones absent here are absent on purpose. `double_counted`, `shared_phone`
 * and `other` have no server filter yet, and `serial_unconfirmed` has one in
 * RecordsFilters that the route does not accept. Rather than send somebody to
 * a list that quietly means something wider, those fall back to the partner's
 * records with the label saying so.
 */
const LEAK_FILTER = {
  correction_open: { preset: "correction" },
  never_called: { preset: "todo" },
  unreachable: { verificationOutcome: "unreachable" },
  not_verified: { verificationOutcome: "not_verified" },
  partially_verified: { verificationOutcome: "partially_verified" },
  // Verified but failing the completeness definition. There is no "incomplete"
  // filter, so this lands on the verified set: a superset, named as one.
  incomplete: { verificationOutcome: "fully_verified" },
};

const FUNNEL_FILTER = {
  sold: {},
  called: {},
  verified: { verificationOutcome: "fully_verified" },
  complete: { verificationOutcome: "fully_verified" },
  creditable: { verificationOutcome: "fully_verified" },
};

/** Unsold stock, in the band that was clicked. */
export function stockDrill({ row, col, by }) {
  const filters = by === "location" ? { state: row.key } : { organizationId: row.key };
  return {
    to: "/data-center/stock",
    search: {
      ...filters,
      ageBucket: col?.key,
      label: col ? `${row.label}, ${col.label}` : row.label,
    },
  };
}

/** Sold stock for a partner: what velocity and absorption are measured over. */
export function soldDrill({ row }) {
  return {
    to: "/data-center/stove-records",
    search: { organizationId: row.key, label: row.label },
  };
}

/** A stage of the creditable-yield chain. */
export function funnelDrill(stage, organizationId, partnerLabel) {
  const filter = FUNNEL_FILTER[stage.key];
  if (!filter) return null;
  return {
    to: "/data-center/call-centre",
    search: {
      ...(organizationId ? { organizationId } : {}),
      ...filter,
      label: partnerLabel ? `${partnerLabel}, ${stage.label.toLowerCase()}` : stage.label,
    },
  };
}

/**
 * A leak reason.
 *
 * When the reason has no exact filter the label says which records the far
 * side is actually showing, so nobody counts a wider list as the answer to a
 * narrower question.
 */
export function leakDrill({ row, col }) {
  if (!col) return null;
  const filter = LEAK_FILTER[col.key];
  return {
    to: "/data-center/call-centre",
    search: {
      organizationId: row.key,
      ...(filter ?? {}),
      label: filter
        ? `${row.label}, ${col.label.toLowerCase()}`
        : `${row.label}, all records (no filter for "${col.label}" yet)`,
    },
  };
}

/** Which leak reasons the far side can actually narrow to. For a footnote. */
export function unfilterableReasons(cols) {
  return (cols ?? []).filter((c) => !LEAK_FILTER[c.key]).map((c) => c.label);
}

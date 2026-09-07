import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CallCentrePartnersPage"));

/**
 * The pool, partner by partner (Phase 26, C2). The underscore keeps it out of
 * the call-centre page, which has no outlet. Every filter, the sort and the
 * page size live in the URL, so back restores the list and a narrowed page can
 * be sent as a link; the keyset cursor does not, because a cursor is a
 * position in a result set that may no longer exist.
 */
type PartnersSearch = {
  q?: string;
  state?: string;
  nobodyOn?: boolean;
  sort?: "waiting" | "new" | "oldest" | "name";
  limit?: number;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const SORTS = new Set(["waiting", "new", "oldest", "name"]);

export const Route = createFileRoute("/data-center/call-centre_/partners")({
  validateSearch: (search: Record<string, unknown>): PartnersSearch => ({
    q: str(search.q),
    state: str(search.state),
    nobodyOn: search.nobodyOn === true || search.nobodyOn === "true" ? true : undefined,
    sort: SORTS.has(String(search.sort)) ? (search.sort as PartnersSearch["sort"]) : undefined,
    limit: Number.isFinite(Number(search.limit)) && Number(search.limit) > 0 ? Number(search.limit) : undefined,
  }),
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/PartnerRecordsPage"));

/**
 * A partner can be opened by link now, not only by finding its row.
 *
 * The stove record names the partner a stove went to, and a name you cannot
 * click is a name you have to go and search for. Both params travel together:
 * the id is what the drill needs, the name is what the heading says while the
 * drill is still loading.
 */
type PartnerRecordsSearch = {
  organizationId?: string;
  partnerName?: string;
  /**
   * The shared period control, as one parameter. `thisYear` is the default and
   * is left out of the URL entirely, so an unfiltered link stays clean.
   */
  period?: string;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/partner-records")({
  validateSearch: (search: Record<string, unknown>): PartnerRecordsSearch => ({
    organizationId: str(search.organizationId),
    partnerName: str(search.partnerName),
    period: str(search.period),
  }),
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { narrowingFrom, type CorrectionsNarrowing } from "@/app/data-center/lib/correctionsSearch";

const Page = lazy(() => import("@/app/data-center/pages/CorrectionWorkspacePage"));

/**
 * One correction, as a place (the underscore keeps it out of the list page, which has no outlet): the whole record with the disputed items marked,
 * the panel that fixes them, and the review. The sale id is in the path so a
 * send-back can be handed to somebody as a link.
 */
export const Route = createFileRoute("/data-center/corrections_/$saleId")({
  // The list's narrowing travels with the record, so "next record" walks the
  // same list the person opened it from (D67).
  validateSearch: (search: Record<string, unknown>): CorrectionsNarrowing => narrowingFrom(search),
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CorrectionWorkspacePage"));

/**
 * One correction, as a place (the underscore keeps it out of the list page, which has no outlet): the whole record with the disputed items marked,
 * the panel that fixes them, and the review. The sale id is in the path so a
 * send-back can be handed to somebody as a link.
 */
export const Route = createFileRoute("/data-center/corrections_/$saleId")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/StoveRecordPage"));

/**
 * The stove ID is the module's anchor, so it belongs in the path rather than
 * the query string: this is a record, not a filtered view of one, and the URL
 * should read like the thing it opens.
 */
export const Route = createFileRoute("/data-center/stove/$stoveId")({
  component: Page,
});

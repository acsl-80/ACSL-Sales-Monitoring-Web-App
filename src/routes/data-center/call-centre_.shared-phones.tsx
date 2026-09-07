import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CallCentreSharedPhonesPage"));

/**
 * Phone numbers shared by more than one stove (Phase 26, C3): the register
 * that sat mid-scroll on the call-centre page, on its own page, where the
 * control centre's "Review" lands.
 */
export const Route = createFileRoute("/data-center/call-centre_/shared-phones")({
  component: Page,
});

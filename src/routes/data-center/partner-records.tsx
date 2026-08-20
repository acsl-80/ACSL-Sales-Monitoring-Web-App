import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/PartnerRecordsPage"));

export const Route = createFileRoute("/data-center/partner-records")({
  component: Page,
});

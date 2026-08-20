import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/StoveRecordsPage"));

export const Route = createFileRoute("/data-center/stove-records")({
  component: Page,
});

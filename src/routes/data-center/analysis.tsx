import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/AnalysisPage"));

export const Route = createFileRoute("/data-center/analysis")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CorrectionsPage"));

export const Route = createFileRoute("/data-center/corrections")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/ImportPage"));

export const Route = createFileRoute("/data-center/import")({
  component: Page,
});

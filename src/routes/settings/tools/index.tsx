import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/settings/tools/page"));

export const Route = createFileRoute("/settings/tools/")({
  component: Page,
});

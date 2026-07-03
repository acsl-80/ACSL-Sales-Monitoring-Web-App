import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/stove-management/page"));

export const Route = createFileRoute("/stove-management/")({
  component: Page,
});

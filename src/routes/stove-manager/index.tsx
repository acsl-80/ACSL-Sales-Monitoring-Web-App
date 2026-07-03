import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/stove-manager/page"));

export const Route = createFileRoute("/stove-manager/")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/change-control/page"));

export const Route = createFileRoute("/change-control/")({
  component: Page,
});

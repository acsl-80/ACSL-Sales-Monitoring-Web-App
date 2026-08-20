import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/DashboardPage"));

export const Route = createFileRoute("/data-center/dashboard")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/dashboard/page"));

export const Route = createFileRoute("/dashboard/")({
  component: Page,
});

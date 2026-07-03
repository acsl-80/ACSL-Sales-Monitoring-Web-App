import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/partner-agents/page"));

export const Route = createFileRoute("/admin/partner-agents/")({
  component: Page,
});

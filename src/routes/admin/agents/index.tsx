import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/agents/page"));

export const Route = createFileRoute("/admin/agents/")({
  component: Page,
});

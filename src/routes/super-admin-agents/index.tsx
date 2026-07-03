import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/super-admin-agents/page"));

export const Route = createFileRoute("/super-admin-agents/")({
  component: Page,
});

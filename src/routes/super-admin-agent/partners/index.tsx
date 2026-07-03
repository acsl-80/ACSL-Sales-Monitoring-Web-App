import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/super-admin-agent/partners/page"));

export const Route = createFileRoute("/super-admin-agent/partners/")({
  component: Page,
});

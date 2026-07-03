import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/super-admin-agent/sales/create/page"));

export const Route = createFileRoute("/super-admin-agent/sales/create/")({
  component: Page,
});

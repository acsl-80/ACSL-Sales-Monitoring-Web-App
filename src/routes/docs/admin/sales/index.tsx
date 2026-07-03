import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/docs/admin/sales/page"));

export const Route = createFileRoute("/docs/admin/sales/")({
  component: Page,
});

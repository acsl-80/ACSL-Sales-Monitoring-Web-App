import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/sales/financial-reports/page"));

export const Route = createFileRoute("/admin/sales/financial-reports/")({
  component: Page,
});

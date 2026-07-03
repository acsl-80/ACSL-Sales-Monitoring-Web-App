import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/sales/financial-reports/page"));

export const Route = createFileRoute("/sales/financial-reports/")({
  component: Page,
});

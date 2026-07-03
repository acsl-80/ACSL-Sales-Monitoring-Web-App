import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/sales/create/page"));

export const Route = createFileRoute("/admin/sales/create/")({
  component: Page,
});

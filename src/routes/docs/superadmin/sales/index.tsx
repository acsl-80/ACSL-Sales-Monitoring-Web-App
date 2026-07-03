import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/docs/superadmin/sales/page"));

export const Route = createFileRoute("/docs/superadmin/sales/")({
  component: Page,
});

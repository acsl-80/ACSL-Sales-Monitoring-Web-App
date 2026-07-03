import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/sales/create/page"));

export const Route = createFileRoute("/sales/create")({
  component: Page,
});

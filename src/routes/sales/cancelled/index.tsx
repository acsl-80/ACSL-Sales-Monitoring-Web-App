import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/sales/cancelled/page"));

export const Route = createFileRoute("/sales/cancelled/")({
  component: Page,
});

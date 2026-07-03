import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/sales/[id]/page"));

export const Route = createFileRoute("/sales/$id/")({
  component: Page,
});

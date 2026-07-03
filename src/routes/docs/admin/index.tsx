import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/docs/admin/page"));

export const Route = createFileRoute("/docs/admin/")({
  component: Page,
});

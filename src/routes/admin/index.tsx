import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/page"));

export const Route = createFileRoute("/admin/")({
  component: Page,
});

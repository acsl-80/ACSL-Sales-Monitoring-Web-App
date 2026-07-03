import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/branches/page"));

export const Route = createFileRoute("/admin/branches/")({
  component: Page,
});

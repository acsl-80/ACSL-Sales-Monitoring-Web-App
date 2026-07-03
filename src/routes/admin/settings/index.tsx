import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/settings/page"));

export const Route = createFileRoute("/admin/settings/")({
  component: Page,
});

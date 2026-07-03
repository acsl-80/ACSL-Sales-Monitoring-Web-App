import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/app-config/page"));

export const Route = createFileRoute("/admin/app-config/")({
  component: Page,
});

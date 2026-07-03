import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/system-config/page"));

export const Route = createFileRoute("/admin/system-config/")({
  component: Page,
});

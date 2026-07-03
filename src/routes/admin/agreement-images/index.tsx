import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/agreement-images/page"));

export const Route = createFileRoute("/admin/agreement-images/")({
  component: Page,
});

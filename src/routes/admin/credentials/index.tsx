import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/admin/credentials/page"));

export const Route = createFileRoute("/admin/credentials/")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/settings/user-management/page"));

export const Route = createFileRoute("/settings/user-management/")({
  component: Page,
});

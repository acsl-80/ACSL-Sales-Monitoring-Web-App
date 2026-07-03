import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/settings/system-config/page"));

export const Route = createFileRoute("/settings/system-config/")({
  component: Page,
});

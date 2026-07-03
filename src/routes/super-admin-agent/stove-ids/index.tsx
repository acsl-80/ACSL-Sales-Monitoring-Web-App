import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/super-admin-agent/stove-ids/page"));

export const Route = createFileRoute("/super-admin-agent/stove-ids/")({
  component: Page,
});

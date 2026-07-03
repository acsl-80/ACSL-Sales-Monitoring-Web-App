import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/agent/page"));

export const Route = createFileRoute("/agent/")({
  component: Page,
});

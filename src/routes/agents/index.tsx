import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/agents/page"));

export const Route = createFileRoute("/agents/")({
  component: Page,
});

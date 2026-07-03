import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/docs/page"));

export const Route = createFileRoute("/docs/")({
  component: Page,
});

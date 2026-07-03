import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/partners/page"));

export const Route = createFileRoute("/partners/")({
  component: Page,
});

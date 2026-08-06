import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/system-documentation/page"));

export const Route = createFileRoute("/system-documentation/")({
  component: Page,
});

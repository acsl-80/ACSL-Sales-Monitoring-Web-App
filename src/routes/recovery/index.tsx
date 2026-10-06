import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/recovery/page"));

export const Route = createFileRoute("/recovery/")({
  component: Page,
});

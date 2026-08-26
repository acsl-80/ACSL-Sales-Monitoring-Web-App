import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/page"));

export const Route = createFileRoute("/data-center/")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/map/page"));

export const Route = createFileRoute("/map/")({
  component: Page,
});

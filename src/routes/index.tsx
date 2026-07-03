import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/page"));

export const Route = createFileRoute("/")({
  component: Page,
});

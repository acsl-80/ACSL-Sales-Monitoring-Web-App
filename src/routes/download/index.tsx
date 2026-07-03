import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/download/page"));

export const Route = createFileRoute("/download/")({
  component: Page,
});

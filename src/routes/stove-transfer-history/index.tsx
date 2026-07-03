import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/stove-transfer-history/page"));

export const Route = createFileRoute("/stove-transfer-history/")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/settings/credentials/page"));

export const Route = createFileRoute("/settings/credentials/")({
  component: Page,
});

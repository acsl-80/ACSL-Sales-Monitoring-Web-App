import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/end-user-records/page"));

export const Route = createFileRoute("/end-user-records/")({
  component: Page,
});

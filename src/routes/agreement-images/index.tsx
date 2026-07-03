import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/agreement-images/page"));

export const Route = createFileRoute("/agreement-images/")({
  component: Page,
});

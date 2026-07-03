import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/unauthorized/page"));

export const Route = createFileRoute("/unauthorized/")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/profile/page"));

export const Route = createFileRoute("/profile/")({
  component: Page,
});

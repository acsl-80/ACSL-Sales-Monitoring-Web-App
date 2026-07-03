import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/user-management/page"));

export const Route = createFileRoute("/user-management/")({
  component: Page,
});

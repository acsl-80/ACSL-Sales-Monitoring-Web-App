import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/user-management/user-groups/page"));

export const Route = createFileRoute("/user-management/user-groups/")({
  component: Page,
});

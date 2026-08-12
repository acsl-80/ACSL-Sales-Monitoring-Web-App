import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/user-guide/page"));

export const Route = createFileRoute("/user-guide/")({
  component: Page,
});

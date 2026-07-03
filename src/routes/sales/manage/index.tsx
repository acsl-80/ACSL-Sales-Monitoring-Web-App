import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/sales/manage/page"));

export const Route = createFileRoute("/sales/manage/")({
  component: Page,
});

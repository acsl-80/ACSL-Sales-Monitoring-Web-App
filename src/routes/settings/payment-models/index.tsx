import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/settings/payment-models/page"));

export const Route = createFileRoute("/settings/payment-models/")({
  component: Page,
});

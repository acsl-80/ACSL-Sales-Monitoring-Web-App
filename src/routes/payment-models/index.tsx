import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/payment-models/page"));

export const Route = createFileRoute("/payment-models/")({
  component: Page,
});

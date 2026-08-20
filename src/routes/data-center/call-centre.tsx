import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CallCentrePage"));

export const Route = createFileRoute("/data-center/call-centre")({
  component: Page,
});

import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/SettingsPage"));

export const Route = createFileRoute("/data-center/settings")({
  component: Page,
});

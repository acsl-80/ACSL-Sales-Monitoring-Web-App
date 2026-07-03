import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/sales-monitoring-app/page"));

export const Route = createFileRoute("/sales-monitoring-app/")({
  head: () => ({
    meta: [
      { title: "Sales Monitoring App — Download for Android | Atmosfair" },
      {
        name: "description",
        content:
          "Download the Atmosfair Sales Monitoring Android app. Real-time sales tracking, offline-first recording, and automatic sync for field agents.",
      },
      {
        property: "og:title",
        content: "Sales Monitoring App — Download for Android | Atmosfair",
      },
      {
        property: "og:description",
        content:
          "Real-time sales tracking, offline-first recording, and automatic sync for field agents.",
      },
    ],
  }),
  component: Page,
});

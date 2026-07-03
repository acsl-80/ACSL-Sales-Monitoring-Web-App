import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/login/page"));

export const Route = createFileRoute("/login/")({
  head: () => ({
    meta: [
      { title: "Sign in — Atmosfair Sales Monitoring" },
      {
        name: "description",
        content:
          "Sign in to the Atmosfair Sales Monitoring dashboard to manage field sales, agents, and performance analytics.",
      },
    ],
  }),
  component: Page,
});

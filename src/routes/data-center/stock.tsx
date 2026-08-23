import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/StockPage"));

/**
 * Analysis drills in here by URL, the same way the dashboard drills into the
 * call centre. `ageBucket` is a band CODE from workflow_config, resolved
 * server-side against the same function compute bucketed with, so the list
 * cannot come to mean something the chart did not.
 */
type StockSearch = {
  organizationId?: string;
  ageBucket?: string;
  state?: string;
  label?: string;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/stock")({
  validateSearch: (search: Record<string, unknown>): StockSearch => ({
    organizationId: str(search.organizationId),
    ageBucket: str(search.ageBucket),
    state: str(search.state),
    label: str(search.label),
  }),
  component: Page,
});

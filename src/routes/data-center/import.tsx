import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/ImportPage"));

/**
 * The import history takes the shared period control, on upload date. One
 * parameter, the same encoding every other Data Centre route uses.
 */
type ImportSearch = { period?: string };

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/import")({
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    period: str(search.period),
  }),
  component: Page,
});

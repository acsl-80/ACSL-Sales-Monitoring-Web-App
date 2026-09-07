import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/ImportPage"));

/**
 * The import history takes the shared period control, on upload date. One
 * parameter, the same encoding every other Data Centre route uses.
 *
 * `mode` is which of the page's four surfaces is up (import redesign, D37):
 * bulk, bench, calls or confirm. In the URL so a reload, a deploy, back and
 * a shared link land on the surface the person was on. Unknown values are
 * dropped and the page falls back to the first surface the person may use.
 */
export const IMPORT_MODES = ["bulk", "bench", "calls", "confirm", "team"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];
type ImportSearch = { period?: string; mode?: ImportMode };

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const mode = (v: unknown): ImportMode | undefined =>
  typeof v === "string" && (IMPORT_MODES as readonly string[]).includes(v)
    ? (v as ImportMode)
    : undefined;

export const Route = createFileRoute("/data-center/import")({
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    period: str(search.period),
    mode: mode(search.mode),
  }),
  component: Page,
});

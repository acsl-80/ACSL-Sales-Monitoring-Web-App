import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/MyCallsPage"));

/**
 * The agent's day (Phase 26, C4): who to call next, what was called, the
 * numbers one click from the clipboard. An agent who opens the call centre
 * lands here. The day and the folded list live in the search so back keeps
 * them.
 */
type MyCallsSearch = { day?: string; done?: boolean };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/data-center/my-calls")({
  validateSearch: (search: Record<string, unknown>): MyCallsSearch => ({
    day: typeof search.day === "string" && DAY.test(search.day) ? search.day : undefined,
    done: search.done === true || search.done === "true" ? true : undefined,
  }),
  component: Page,
});

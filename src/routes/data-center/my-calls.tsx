import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/MyCallsPage"));

/**
 * The agent's day (Phase 26, C4; Phase 28, D45): who to call next, what was
 * called, the numbers one click from the clipboard. An agent who opens the
 * call centre lands here. The day, the window, the open view and the folded
 * list live in the search so back keeps them. New is the default view and
 * stays out of the URL.
 */
type MyCallsSearch = { day?: string; range?: string; view?: string; done?: boolean };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SPAN = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/;
const VIEWS = ["verified", "partially_verified", "unreachable", "with_sales", "others", "all"];

export const Route = createFileRoute("/data-center/my-calls")({
  validateSearch: (search: Record<string, unknown>): MyCallsSearch => ({
    day: typeof search.day === "string" && DAY.test(search.day) ? search.day : undefined,
    range:
      search.range === "week" || (typeof search.range === "string" && SPAN.test(search.range))
        ? search.range
        : undefined,
    view: typeof search.view === "string" && VIEWS.includes(search.view) ? search.view : undefined,
    done: search.done === true || search.done === "true" ? true : undefined,
  }),
  component: Page,
});

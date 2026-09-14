import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CallCentreAgentPage"));

/**
 * One agent's day (Phase 26, C3): their track, what they still have to call
 * and what they concluded, by date. The agent id is in the path so a row on
 * the board can be handed to somebody as a link; the day lives in the search
 * like the board's.
 */
type AgentSearch = { day?: string; range?: string; tab?: "to_call" | "called" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RANGE = /^(week|\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/;
// The router parses a bare year in the URL as a number; it is still the year.
const rangeOf = (v: unknown): string | undefined => {
  const s = typeof v === "number" ? String(v) : v;
  return typeof s === "string" && RANGE.test(s) ? s : undefined;
};

export const Route = createFileRoute("/data-center/call-centre_/agents/$agentId")({
  validateSearch: (search: Record<string, unknown>): AgentSearch => ({
    day: typeof search.day === "string" && DAY.test(search.day) ? search.day : undefined,
    range: rangeOf(search.range),
    tab: search.tab === "called" ? "called" : search.tab === "to_call" ? "to_call" : undefined,
  }),
  component: Page,
});

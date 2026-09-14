/**
 * The States Performance Report, from one request, under React Query.
 *
 * Slice 10a of the 2026-09-02 review (finding F8). The report pulled every
 * stove and every sale into the browser and joined them in JavaScript; the
 * database now computes it in one call (report_states_performance) and pages
 * the stove modal in another (report_state_stoves). A realtime change on the
 * tables behind it invalidates the query key instead of re-running the load.
 */

import { useCallback } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllPages, type PageProgress } from "@/lib/fetchAllPages";
import { callPerformanceReport } from "../services/performanceReportService";

export const STATES_REPORT_KEY = ["performance-report", "states"] as const;
/** The most rows one stove-modal request may carry; the function clamps to this. */
export const STOVE_EXPORT_PAGE = 500;

export interface PartnerDetail {
  id: string;
  name: string;
  phone: string;
  totalStoves: number;
  stovesSold: number;
  stovesAvailable: number;
}

export interface AgentDetail {
  id: string;
  name: string;
  role: string;
  statesCovered: string[];
  stovesRecorded: number;
}

export interface StateRow {
  state: string;
  partners: number;
  partnerAgents: number;
  acslAgents: number;
  agents: number;
  stoves: number;
  sold: number;
  notSold: number;
  sellThrough: number;
  partnerDetails: PartnerDetail[];
  agentDetails: AgentDetail[];
}

export type StoveStatus = "all" | "sold" | "available";

export interface StoveDetail {
  stove_id: string;
  partner_name: string;
  status: "sold" | "available";
}

type StatesPayload = {
  states: Array<{
    state: string;
    partners: number;
    partner_agents: number;
    acsl_agents: number;
    stoves: number;
    sold: number;
    not_sold: number;
    partner_details: Array<{
      id: string;
      name: string | null;
      phone: string | null;
      total_stoves: number;
      stoves_sold: number;
      stoves_available: number;
    }>;
    agent_details: Array<{
      id: string;
      name: string | null;
      role: string;
      states_covered: string[];
      stoves_recorded: number;
    }>;
  }>;
  covered_states: string[];
  computed_at: string;
};

/** The server's shape as the screen reads it. Pure. */
export function toStateRows(payload: StatesPayload | null | undefined): StateRow[] {
  return (payload?.states ?? []).map((s) => {
    const stoves = Number(s.stoves ?? 0);
    const sold = Number(s.sold ?? 0);
    const partnerAgents = Number(s.partner_agents ?? 0);
    const acslAgents = Number(s.acsl_agents ?? 0);
    return {
      state: s.state,
      partners: Number(s.partners ?? 0),
      partnerAgents,
      acslAgents,
      agents: partnerAgents + acslAgents,
      stoves,
      sold,
      notSold: Math.max(0, Number(s.not_sold ?? stoves - sold)),
      sellThrough: stoves > 0 ? sold / stoves : 0,
      partnerDetails: (s.partner_details ?? []).map((p) => ({
        id: p.id,
        name: p.name || "Unknown",
        phone: p.phone || "—",
        totalStoves: Number(p.total_stoves ?? 0),
        stovesSold: Number(p.stoves_sold ?? 0),
        stovesAvailable: Number(p.stoves_available ?? 0),
      })),
      agentDetails: (s.agent_details ?? []).map((a) => ({
        id: a.id,
        name: a.name || "Unknown",
        role: a.role,
        statesCovered: a.states_covered ?? [],
        stovesRecorded: Number(a.stoves_recorded ?? 0),
      })),
    };
  });
}

export function useStatesPerformance() {
  const queryClient = useQueryClient();
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: STATES_REPORT_KEY });
  }, [queryClient]);
  const query = useQuery({
    queryKey: STATES_REPORT_KEY,
    queryFn: async () => {
      const result = await callPerformanceReport<StatesPayload>({ action: "states" });
      return {
        rows: toStateRows(result.data),
        coveredStates: new Set<string>(result.data?.covered_states ?? []),
      };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    coveredStates: query.data?.coveredStates ?? new Set<string>(),
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    /** What a realtime change or a manual refresh calls: the key is marked stale and refetched. */
    invalidate,
  };
}

export interface StoveQuery {
  state: string | null;
  status: StoveStatus;
  search: string;
  page: number;
  limit: number;
}

async function getStovePage(q: StoveQuery, page: number, limit: number) {
  const result = await callPerformanceReport<StoveDetail[]>({
    action: "state-stoves",
    state: q.state,
    status: q.status,
    search: q.search.trim() || undefined,
    page,
    limit,
  });
  return { rows: result.data ?? [], total: Number(result.pagination?.total ?? result.data?.length ?? 0) };
}

/** One page of the stoves in a state; the previous page stays on screen while the next loads. */
export function useStateStoves(q: StoveQuery) {
  const query = useQuery({
    queryKey: ["performance-report", "state-stoves", q],
    queryFn: () => getStovePage(q, q.page, q.limit),
    enabled: Boolean(q.state),
    placeholderData: keepPreviousData,
  });
  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
  };
}

/** Every stove the modal's filter allows, for its export. */
export function fetchAllStateStoves(q: StoveQuery, onProgress?: (p: PageProgress) => void) {
  return fetchAllPages<StoveDetail>((page, limit) => getStovePage(q, page, limit), {
    limit: STOVE_EXPORT_PAGE,
    onProgress,
  });
}

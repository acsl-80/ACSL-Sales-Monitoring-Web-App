/**
 * The Agents Performance Report's numbers, from one request, under React Query.
 *
 * Slice 10b of the 2026-09-02 review (finding F8). The tab hydrated its rows
 * with two requests per agent and paged every stove of every assigned partner
 * into the browser; the database now answers for every listed agent in one
 * call (report_agents_performance). A realtime change invalidates the key.
 */

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { callPerformanceReport } from "../services/performanceReportService";

export const AGENTS_REPORT_KEY = ["performance-report", "agents"] as const;

export interface AgentPerformance {
  id: string;
  received: number;
  sold: number;
  available: number;
  directOrgCount: number;
  directOrgIds: string[];
  states: string[];
}

export interface AgentsTotals {
  assigned: number;
  sold: number;
  unsold: number;
}

type AgentsPayload = {
  agents: Array<{
    id: string;
    received: number;
    sold: number;
    available: number;
    direct_org_count: number;
    direct_org_ids: string[];
    states: string[];
  }>;
  totals: { assigned: number; sold: number; unsold: number };
  computed_at: string;
};

export function useAgentsPerformance(agentIds: string[]) {
  const queryClient = useQueryClient();
  // The key is the sorted id list, so the same agents in another order share a query.
  const idsKey = useMemo(() => [...new Set(agentIds)].sort().join(","), [agentIds]);
  const query = useQuery({
    queryKey: [...AGENTS_REPORT_KEY, idsKey],
    enabled: idsKey.length > 0,
    queryFn: async () => {
      const result = await callPerformanceReport<AgentsPayload>({ action: "agents", agent_ids: idsKey.split(",") });
      const byId = new Map<string, AgentPerformance>();
      for (const a of result.data?.agents ?? []) {
        byId.set(a.id, {
          id: a.id,
          received: Number(a.received ?? 0),
          sold: Number(a.sold ?? 0),
          available: Number(a.available ?? 0),
          directOrgCount: Number(a.direct_org_count ?? 0),
          directOrgIds: a.direct_org_ids ?? [],
          states: a.states ?? [],
        });
      }
      const t = result.data?.totals;
      const totals: AgentsTotals = {
        assigned: Number(t?.assigned ?? 0),
        sold: Number(t?.sold ?? 0),
        unsold: Number(t?.unsold ?? 0),
      };
      return { byId, totals };
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: AGENTS_REPORT_KEY });
  }, [queryClient]);

  return {
    byId: query.data?.byId ?? null,
    totals: query.data?.totals ?? null,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    invalidate,
  };
}

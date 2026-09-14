/**
 * The agents covering each partner on the page, from one request.
 *
 * Slice 10b of the 2026-09-02 review (finding F8). The Partners tab asked
 * the agents function for each row's agents one row at a time; the database
 * now answers for the whole page in one call (report_partner_agents). A
 * realtime change invalidates the key.
 */

import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { callPerformanceReport } from "../../agents/services/performanceReportService";

export const PARTNER_AGENTS_KEY = ["performance-report", "partner-agents"] as const;

export interface PartnerAgent {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string | null;
  source: "explicit" | "state";
  partner_sales_count: number;
  partner_sales_amount: number;
  partner_sold_stoves_count: number;
  partner_attended_count: number;
  partner_unattended_count: number;
}

export type PartnerAgentsByOrg = Record<string, PartnerAgent[]>;

export function usePartnerAgents(organizationIds: string[]) {
  const queryClient = useQueryClient();
  const idsKey = useMemo(() => [...new Set(organizationIds)].sort().join(","), [organizationIds]);
  const query = useQuery({
    queryKey: [...PARTNER_AGENTS_KEY, idsKey],
    enabled: idsKey.length > 0,
    queryFn: async () => {
      const result = await callPerformanceReport<PartnerAgentsByOrg>({
        action: "partner-agents",
        organization_ids: idsKey.split(","),
      });
      const byOrg: PartnerAgentsByOrg = {};
      for (const id of idsKey.split(",")) byOrg[id] = result.data?.[id] ?? [];
      return byOrg;
    },
    placeholderData: keepPreviousData,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PARTNER_AGENTS_KEY });
  }, [queryClient]);

  return {
    /** Agents keyed by organisation id; an id is absent until its page has answered. */
    byOrg: query.data ?? {},
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    invalidate,
  };
}

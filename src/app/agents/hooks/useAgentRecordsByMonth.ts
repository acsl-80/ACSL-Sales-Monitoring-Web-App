/**
 * The Agents Performance Report chart's twelve months, from one request.
 *
 * Slice 11c of the 2026-09-02 review (finding F7). The chart paged the agent
 * roster through three role loops and read the sales table twice per two
 * hundred agents; the database now answers one year in one call
 * (report_agent_records_by_month).
 */

import { useQuery } from "@tanstack/react-query";
import { callPerformanceReport } from "../services/performanceReportService";

export const AGENT_RECORDS_KEY = ["performance-report", "agent-records"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthPoint {
  month: string;
  value: number;
}

type Payload = { year: number; months: Array<{ month: number; records: number }>; total: number };

/** The year the chart shows: the page's chosen start date, else this year in Lagos. */
export function chartYear(dateFrom?: string | null): number {
  const fromYear = dateFrom ? Number.parseInt(dateFrom.slice(0, 4), 10) : Number.NaN;
  if (Number.isFinite(fromYear) && fromYear > 2000) return fromYear;
  return Number.parseInt(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }).slice(0, 4), 10);
}

export function useAgentRecordsByMonth(year: number) {
  const query = useQuery({
    queryKey: [...AGENT_RECORDS_KEY, year],
    queryFn: async () => {
      const result = await callPerformanceReport<Payload>({ action: "agent-records", year });
      const byMonth = new Map((result.data?.months ?? []).map((m) => [Number(m.month), Number(m.records ?? 0)]));
      return {
        monthly: MONTHS.map((label, i) => ({ month: label, value: byMonth.get(i + 1) ?? 0 })) as MonthPoint[],
        total: Number(result.data?.total ?? 0),
      };
    },
  });
  return {
    monthly: query.data?.monthly ?? MONTHS.map((label) => ({ month: label, value: 0 })),
    total: query.data?.total ?? 0,
    isPending: query.isPending,
    error: query.error ? (query.error as Error).message : null,
  };
}

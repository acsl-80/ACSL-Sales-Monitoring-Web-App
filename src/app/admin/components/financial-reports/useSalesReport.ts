/**
 * The query half of the Sales Records report: one request per page, with the
 * filters as the server understands them, under React Query.
 *
 * Slice 9a of the 2026-09-02 review (finding F6). The view loaded at most
 * 500 sales and did everything in the browser; past five hundred every
 * number on the screen was computed over the first five hundred and shown
 * as the whole. The server now pages, filters, sorts and totals, and this is
 * the one place the screen's state becomes a request.
 */

import { useMemo } from "react";
import { useSettled } from "@/lib/useSettled";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import salesAdvancedService from "../../../services/salesAdvancedAPIService";
import type { AdminSales } from "@/types/adminSales";
import type { TrackingKey } from "./SalesTrackingBar";
import { EMPTY_SUMMARY, periodsFor, readSummary, type SalesReportSummary } from "./salesReportSummary";

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type ReportFilters = {
  search: string;
  paymentStatus: string;
  startDate: string;
  endDate: string;
  state: string;
  lga: string;
  organizationId: string;
  approval: string;
  salesModelId: string;
  month: string;
  yearFilter: string;
  selectedYears: number[];
  availableYears: number[];
  tracking: TrackingKey;
  sortOrder: "asc" | "desc";
  page: number;
  pageSize: number;
};

/** The screen's state as the request get-sales-advanced takes. Pure. */
export function buildReportRequest(f: ReportFilters): Record<string, unknown> {
  const periods = periodsFor({
    selectedYears: f.selectedYears,
    availableYears: f.availableYears,
    yearFilter: f.yearFilter,
    month: f.month,
  });
  return {
    page: f.page,
    limit: f.pageSize,
    sortBy: "sales_date",
    sortOrder: f.sortOrder,
    responseFormat: "format2",
    includeCreator: true,
    withSummary: true,
    ...(f.search.trim() ? { search: f.search.trim() } : {}),
    ...(f.paymentStatus !== "all" ? { paymentStatus: f.paymentStatus } : {}),
    ...(f.startDate ? { dateFrom: f.startDate } : {}),
    ...(f.endDate ? { dateTo: f.endDate } : {}),
    ...(f.state !== "all" ? { state: f.state } : {}),
    ...(f.lga !== "all" ? { lga: f.lga } : {}),
    ...(f.organizationId !== "all" ? { organizationId: f.organizationId } : {}),
    ...(f.approval !== "all" ? { agentApproved: f.approval === "approved" } : {}),
    ...(f.salesModelId !== "all" ? { paymentModelId: f.salesModelId } : {}),
    ...(periods.length ? { periods } : {}),
    ...(f.tracking !== "none" ? { dueBucket: f.tracking } : {}),
  };
}

export type SalesReport = {
  rows: AdminSales[];
  total: number;
  summary: SalesReportSummary;
  isPending: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => void;
};

export function useSalesReport(filters: ReportFilters, reloadKey = 0): SalesReport {
  const search = useSettled(filters.search);
  const request = useMemo(() => buildReportRequest({ ...filters, search }), [filters, search]);

  const query = useQuery({
    queryKey: ["sales-report", request, reloadKey],
    queryFn: async () => {
      const response: any = await salesAdvancedService.getSalesData(request, "POST", "SalesRecords");
      if (!response?.success) {
        throw new Error(String(response?.error || response?.message || "the server did not answer"));
      }
      return {
        rows: (response.data ?? []) as AdminSales[],
        total: Number(response.pagination?.total ?? response.data?.length ?? 0),
        summary: readSummary(response.summary),
      };
    },
    placeholderData: keepPreviousData,
  });

  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    summary: query.data?.summary ?? EMPTY_SUMMARY,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

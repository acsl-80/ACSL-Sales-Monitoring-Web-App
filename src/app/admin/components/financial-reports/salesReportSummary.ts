/**
 * The pure half of the Sales Records report: what the server's summary means
 * on screen, and how the screen's period filters become date windows.
 *
 * Slice 9a of the 2026-09-02 review. Nothing here touches React or the
 * network, so the shapes the cards, the status counts and the due chips read
 * can be checked in isolation and reused by any screen that shows sales.
 */

import type { TrackingKey } from "./SalesTrackingBar";

/** What get-sales-advanced returns under `summary` when asked for it. */
export type SalesReportSummary = {
  total: number;
  receivable: number;
  collected: number;
  outstanding: number;
  fully_paid: number;
  partially_paid: number;
  unpaid: number;
  due: { overdue: number; dueToday: number; due7: number; due14: number; due30: number };
  years: number[];
  partners: { id: string; partner_name: string }[];
  bucket_total?: number | null;
  bucket_ids?: string[] | null;
};

export const EMPTY_SUMMARY: SalesReportSummary = {
  total: 0,
  receivable: 0,
  collected: 0,
  outstanding: 0,
  fully_paid: 0,
  partially_paid: 0,
  unpaid: 0,
  due: { overdue: 0, dueToday: 0, due7: 0, due14: 0, due30: 0 },
  years: [],
  partners: [],
};

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** The server's jsonb, coerced: every number a number, every list a list. */
export function readSummary(raw: unknown): SalesReportSummary {
  const s = (raw ?? {}) as Record<string, any>;
  const due = (s.due ?? {}) as Record<string, unknown>;
  return {
    total: n(s.total),
    receivable: n(s.receivable),
    collected: n(s.collected),
    outstanding: n(s.outstanding),
    fully_paid: n(s.fully_paid),
    partially_paid: n(s.partially_paid),
    unpaid: n(s.unpaid),
    due: {
      overdue: n(due.overdue),
      dueToday: n(due.dueToday),
      due7: n(due.due7),
      due14: n(due.due14),
      due30: n(due.due30),
    },
    years: Array.isArray(s.years) ? s.years.map(n).filter((y: number) => y > 0) : [],
    partners: Array.isArray(s.partners)
      ? s.partners
          .filter((p: any) => p && p.id)
          .map((p: any) => ({ id: String(p.id), partner_name: String(p.partner_name ?? "Unknown Partner") }))
      : [],
    bucket_total: s.bucket_total == null ? null : n(s.bucket_total),
    bucket_ids: Array.isArray(s.bucket_ids) ? s.bucket_ids.map(String) : null,
  };
}

/** The three cards at the top of the report. */
export function toFinancialSummary(s: SalesReportSummary) {
  return {
    totalReceivable: s.receivable,
    totalCollected: s.collected,
    outstandingBalance: s.outstanding,
    salesCount: s.total,
    collectedPercent: s.receivable > 0 ? (s.collected / s.receivable) * 100 : 0,
    outstandingPercent: s.receivable > 0 ? (s.outstanding / s.receivable) * 100 : 0,
  };
}

/** The counts the due chips carry. */
export function toTrackingCounts(s: SalesReportSummary): Record<Exclude<TrackingKey, "none">, number> {
  return { ...s.due };
}

const pad = (v: number) => String(v).padStart(2, "0");

/**
 * The screen's period filters as date windows, {from} inclusive and {to}
 * exclusive, the way the server applies them.
 *
 *   years only            one window per selected year
 *   a year and a month    that month of that year
 *   a month, no year      that month of every selected year
 *
 * An empty list means no period filter. The custom start and end dates are
 * separate and stay separate: they narrow whatever the windows allow.
 */
export function periodsFor(args: {
  selectedYears: number[];
  availableYears: number[];
  yearFilter: string;
  month: string;
}): Array<{ from: string; to: string }> {
  const { selectedYears, availableYears, yearFilter, month } = args;
  const everyYear = selectedYears.length === 0 || selectedYears.length >= availableYears.length;
  const years = yearFilter !== "all" ? [Number(yearFilter)] : everyYear ? [] : [...selectedYears];
  const m = month !== "all" ? Number(month) : null; // 0..11 as the screen counts it

  if (m === null) {
    return years.map((y) => ({ from: `${y}-01-01`, to: `${y + 1}-01-01` }));
  }
  const base = years.length ? years : availableYears.length ? availableYears : [new Date().getFullYear()];
  return base.map((y) => {
    const nextY = m === 11 ? y + 1 : y;
    const nextM = m === 11 ? 1 : m + 2;
    return { from: `${y}-${pad(m + 1)}-01`, to: `${nextY}-${pad(nextM)}-01` };
  });
}

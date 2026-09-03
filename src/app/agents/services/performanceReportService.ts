/**
 * The one door to the performance-report edge function.
 *
 * Slice 10a of the 2026-09-02 review. Every Performance Report request goes
 * through here with the caller's token; the function checks the role and
 * answers from SQL.
 */

import tokenManager from "@/utils/tokenManager";
import { supabaseFunctionsUrl } from "@/lib/supabaseConfig";

export type PerformanceReportPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type Envelope<T> = {
  success: boolean;
  data: T;
  pagination?: PerformanceReportPagination;
  error?: string;
  message?: string;
};

export async function callPerformanceReport<T>(body: Record<string, unknown>): Promise<Envelope<T>> {
  const token = await tokenManager.getValidToken();
  if (!token) throw new Error("Your session has expired. Sign in again.");

  const response = await fetch(`${supabaseFunctionsUrl}/performance-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || result?.message || `The report did not answer (HTTP ${response.status})`);
  }
  return result;
}

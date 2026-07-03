
import tokenManager from "@/utils/tokenManager";

export interface SyncLogEntry {
  step: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  detail?: any;
  ts: string;
}

export interface SyncLog {
  id: string;
  source: "external-sync" | "external-csv-sync";
  status: "success" | "partial" | "failed";
  application_name: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  total_partners: number;
  partners_created: number;
  partners_updated: number;
  partners_failed: number;
  total_stove_ids: number;
  stove_ids_created: number;
  stove_ids_skipped: number;
  entries?: SyncLogEntry[];
  request_summary: any;
  error_message: string | null;
  created_at: string;
}

export interface SyncLogsResponse {
  success: boolean;
  data: SyncLog[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface SyncLogsFilters {
  source?: "external-sync" | "external-csv-sync" | "";
  status?: "success" | "partial" | "failed" | "";
  application_name?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

class SyncLogsService {
  private getApiBase(): string {
    const url = import.meta.env.VITE_SUPABASE_URL;
    if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
    return `${url}/functions/v1/get-sync-logs`;
  }

  private async getHeaders(): Promise<HeadersInit> {
    const token = await tokenManager.getValidToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async getLogs(filters: SyncLogsFilters = {}): Promise<SyncLogsResponse> {
    const params = new URLSearchParams();
    if (filters.source) params.set("source", filters.source);
    if (filters.status) params.set("status", filters.status);
    if (filters.application_name) params.set("application_name", filters.application_name);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    params.set("limit", String(filters.limit ?? 50));
    params.set("offset", String(filters.offset ?? 0));

    const url = `${this.getApiBase()}?${params.toString()}`;
    const headers = await this.getHeaders();
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async getLogDetail(id: string): Promise<SyncLog> {
    const url = `${this.getApiBase()}?include_entries=true&limit=1&offset=0`;
    // We fetch with entries and filter by ID — or use a specific id param
    const headers = await this.getHeaders();
    // The edge function doesn't have single-log endpoint, so we pass include_entries
    // and filter. For now, re-use the list endpoint with a narrow filter.
    // Better: add ?id=xxx support to the edge function via a simple workaround
    const res = await fetch(`${this.getApiBase()}?include_entries=true&id=${id}`, { method: "GET", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: SyncLogsResponse = await res.json();
    if (!json.data?.length) throw new Error("Log not found");
    return json.data[0];
  }
}

const syncLogsService = new SyncLogsService();
export default syncLogsService;


import tokenManager from "@/utils/tokenManager";
import { supabaseUrl } from "@/lib/supabaseConfig";


export interface StoveEntry {
  stove_id: string;
  factory?: string;
  sales_reference?: string;
}

export interface TransferRecord {
  id: string;
  transaction_id: string;
  organization_id: string | null;
  partner_name: string;
  partner_id: string;
  state: string | null;
  branch: string | null;
  sales_factory: string | null;
  stove_count: number;
  stove_ids: StoveEntry[];
  source: "external-sync" | "external-csv-sync";
  application_name: string | null;
  transfer_date: string;
  sales_date: string | null;
  created_at: string;
}

export interface TransferHistoryResponse {
  success: boolean;
  data: TransferRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface TransferHistoryFilters {
  search?: string;
  source?: "external-sync" | "external-csv-sync" | "";
  date_from?: string;
  date_to?: string;
  sort_order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

class TransferHistoryService {
  private getApiBase(): string {
    const url = supabaseUrl;
    if (!url) throw new Error("Supabase URL is not configured");
    return `${url}/functions/v1/get-transfer-history`;
  }


  private async getHeaders(): Promise<HeadersInit> {
    const token = await tokenManager.getValidToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async getHistory(filters: TransferHistoryFilters = {}): Promise<TransferHistoryResponse> {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.source) params.set("source", filters.source);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    if (filters.sort_order) params.set("sort_order", filters.sort_order);
    params.set("limit", String(filters.limit ?? 20));
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
}

const transferHistoryService = new TransferHistoryService();
export default transferHistoryService;

/**
 * The Data Center module's only data path.
 *
 * Nothing else under `src/app/data-center/` may call `getSupabase()` for module
 * data. Everything goes through here, which keeps the boundary in one file: if
 * this module ever needs to move, this is the seam.
 *
 * Why the module cannot use the Supabase client directly: `data_center` is
 * deliberately absent from `[api].schemas` in supabase/config.toml, so
 * PostgREST does not expose it and `supabase.from(...)` cannot reach it. That
 * omission is the isolation guarantee, and it is also what stops the
 * sales-mobile Flutter app seeing this data. The `data-center-*` edge functions
 * connect to Postgres directly instead.
 */

import { getSupabase } from "@/lib/supabaseClient";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";

/** Block 31: nothing waits forever. */
const REQUEST_TIMEOUT_MS = 20_000;

export class DataCenterError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "unknown") {
    super(message);
    this.name = "DataCenterError";
    this.status = status;
    this.code = code;
  }
}

async function authHeader(): Promise<string> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) {
    throw new DataCenterError("Your session has expired. Please sign in again.", 401, "no_session");
  }
  return `Bearer ${data.session.access_token}`;
}

/**
 * Call a `data-center-*` edge function.
 *
 * The caller's grants are resolved server-side from this token on every
 * request. Nothing here is trusted to have gated anything.
 */
async function call<T>(fn: string, action: string, payload: unknown = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await authHeader(),
      },
      body: JSON.stringify({ action, ...(payload as object) }),
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A non-JSON body from an edge function is always a failure, so fall
      // through to the status check rather than guessing at the content.
    }

    if (!response.ok) {
      const detail = body as { error?: string; code?: string } | null;
      throw new DataCenterError(
        detail?.error ?? `Request to ${fn} failed.`,
        response.status,
        detail?.code ?? "request_failed",
      );
    }

    // Block 13: validate the shape rather than trusting it.
    if (body === null || typeof body !== "object" || !("data" in body)) {
      throw new DataCenterError(
        `Malformed response from ${fn}.`,
        502,
        "malformed_response",
      );
    }

    return (body as { data: T }).data;
  } catch (err) {
    if (err instanceof DataCenterError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new DataCenterError(
        "The Data Center took too long to respond. Please try again.",
        504,
        "timeout",
      );
    }
    // Block 34: log the detail, hand the user something calm.
    console.error(`[data-center] ${fn}/${action} failed`, err);
    throw new DataCenterError("Could not reach the Data Center.", 0, "network");
  } finally {
    clearTimeout(timer);
  }
}

export type AccessResponse = {
  /** May this user enter the module at all? Case-by-case per user. */
  hasAccess: boolean;
  /** viewer | editor for granted users; null for super_admin and the denied. */
  accessRole: "viewer" | "editor" | null;
  /** Effective feature keys: what the level implies plus individual grants. */
  features: string[];
  /** True when the host role short-circuits every check, mirroring usePermissions. */
  isSuperAdmin: boolean;
  organizationId: string | null;
};

export type AccessListEntry = {
  user_id: string;
  access_role: "viewer" | "editor";
  granted_at: string;
  full_name: string | null;
  email: string | null;
  app_role: string | null;
  granted_by_name: string | null;
};

export type UserSearchResult = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  current_access: "viewer" | "editor" | null;
};

export type ChangeLogEntry = {
  id: string;
  table_name: string;
  record_pk: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_at: string;
  changed_by_name: string | null;
};

/** The cursor is opaque to the client: it is handed back exactly as received. */
export type RecordsCursor = { salesDate: string | null; saleId: string };

export type RecordsFilters = {
  search?: string;
  organizationId?: string | null;
  userState?: string;
  saleStatus?: string;
  paymentStatus?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;
};

export type SoldStoveRow = {
  sale_id: string;
  transaction_id: string | null;
  /** ISO YYYY-MM-DD. Cast to text server-side so no timezone can shift it. */
  sales_date: string | null;
  stove_serial_no: string | null;
  end_user_name: string | null;
  aka: string | null;
  primary_phone: string | null;
  alternative_phone: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  partner_name: string | null;
  retailer_branch: string | null;
  user_state: string | null;
  user_lga: string | null;
  user_residential_address: string | null;
  amount: string | number | null;
  total_paid: string | number | null;
  payment_status: string | null;
  is_installment: boolean | null;
  sale_status: string | null;
  is_archived: boolean | null;
  platform: string | null;
  created_at: string | null;
  organization_id: string | null;
  partner_state: string | null;
  partner_branch: string | null;
  partner_id: string | null;
  sales_model: string | null;
  sale_agent_name: string | null;
  previous_stove_type: string | null;
  pot_quantity: number | null;
  heat_retention_device: boolean | null;
  stove_stock_status: string | null;
};

export type RecordsPage = {
  rows: SoldStoveRow[];
  nextCursor: RecordsCursor | null;
  hasMore: boolean;
  pageSize: number;
  /** Plain-language description of what this caller is allowed to see. */
  scope: string;
};

export const dataCenterClient = {
  /**
   * Resolve the caller's access. Called once when the module mounts. The
   * answer is advisory to the UI and authoritative nowhere: every subsequent
   * call re-resolves access server-side from the same token.
   */
  getAccess: () => call<AccessResponse>("data-center-read", "access"),

  /**
   * One page of Table 1.
   *
   * There is no page number and no offset, by design. Paging forward means
   * passing back the `nextCursor` from the previous page, which is what keeps
   * the query cost flat at 500,000 rows. Filtering, sorting and searching all
   * happen in Postgres; nothing here narrows a set it already received.
   */
  getRecords: (params: {
    cursor?: RecordsCursor | null;
    limit?: number;
    direction?: "asc" | "desc";
    filters?: RecordsFilters;
  } = {}) => call<RecordsPage>("data-center-read", "records", params),

  /** Table 2. Same paging contract, plus the call centre's own filters. */
  getCallQueue: (params: {
    cursor?: RecordsCursor | null;
    limit?: number;
    direction?: "asc" | "desc";
    filters?: RecordsFilters;
  } = {}) => call<RecordsPage>("data-center-read", "call_queue", params),
};

/**
 * A question, as the registry defines it.
 *
 * Nothing in the client hard-codes the questionnaire. This shape is all the
 * form renderer knows, which is what makes adding a question an insert rather
 * than a release.
 */
export type FieldDef = {
  key: string;
  label: string;
  section: string;
  input_type: "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "boolean" | "computed";
  option_list_key: string | null;
  storage: "answers" | "column";
  sort_order: number;
  is_required: boolean;
  help_text: string | null;
  /** e.g. {"field":"verification_outcome","in":["partially_verified"]} */
  visible_when: { field: string; in: string[] } | null;
  validation: Record<string, unknown> | null;
};

export type OptionValue = {
  id: string;
  list_key: string;
  value: string;
  label: string;
  sort_order: number;
};

export type FormSchema = {
  fields: FieldDef[];
  /** Keyed by option_list_key. */
  options: Record<string, OptionValue[]>;
};

export type CallAttempt = {
  id: string;
  attempt_no: number;
  attempted_at: string;
  outcome: string | null;
  agent: string | null;
  answered_by: string | null;
  note: string | null;
};

/**
 * Call centre writes. Separate from the read client so a token that can see the
 * queue is not automatically one that can change it, and so the two can be
 * granted apart.
 */
export const dataCenterWrite = {
  /** The questionnaire's definition. Fetched, never bundled. */
  formSchema: () => call<FormSchema>("data-center-write", "form_schema"),

  callRecord: (saleId: string) =>
    call<{ record: Record<string, unknown>; attempts: CallAttempt[] }>(
      "data-center-write",
      "call_record",
      { saleId },
    ),

  /**
   * Save. `version` is the one read with the record: the server refuses a
   * stale one rather than merging, because merging two people's answers to the
   * same question is a guess.
   */
  saveCallRecord: (saleId: string, values: Record<string, unknown>, version: number | null) =>
    call<{ saleId: string; version: number }>("data-center-write", "save_call_record", {
      saleId,
      values,
      version,
    }),

  /** The attempt number is assigned server-side, never sent. */
  logAttempt: (saleId: string, attempt: {
    attemptedAt?: string;
    outcomeId?: string | null;
    agentId?: string | null;
    answeredById?: string | null;
    note?: string | null;
  }) => call<{ attemptNo: number }>("data-center-write", "log_attempt", { saleId, ...attempt }),

  /** Send back to Sales, or mark the correction done. */
  correction: (saleId: string, open: boolean, reasonId?: string | null, note?: string | null) =>
    call<{ saleId: string; correctionOpen: boolean }>("data-center-write", "correction", {
      saleId,
      open,
      reasonId,
      note,
    }),
};

/** Access administration. Server-gated to super_admin or grants.manage. */
export const dataCenterAdmin = {
  listAccess: () => call<AccessListEntry[]>("data-center-admin", "access_list"),
  searchUsers: (query: string) =>
    call<UserSearchResult[]>("data-center-admin", "user_search", { query }),
  grantAccess: (userId: string, accessRole: "viewer" | "editor") =>
    call("data-center-admin", "access_grant", { userId, accessRole }),
  revokeAccess: (userId: string) =>
    call("data-center-admin", "access_revoke", { userId }),
  changeLog: (limit = 25) =>
    call<ChangeLogEntry[]>("data-center-admin", "change_log", { limit }),
};

export default dataCenterClient;

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

export type TransferFunnelRow = {
  transfer_id: string;
  transaction_id: string;
  organization_id: string | null;
  partner_name: string | null;
  partner_id: string | null;
  transfer_state: string | null;
  transfer_branch: string | null;
  sales_rep: string | null;
  /** ISO YYYY-MM-DD, cast to text server-side so no timezone can shift it. */
  sales_date: string | null;
  transfer_date: string | null;
  issued_count: number;
  received_count: number;
  /** False when received is standing in for digitalised, no paper logged. */
  received_is_logged: boolean;
  digitalised_count: number;
  verified_count: number;
  unverified_count: number;
  unreachable_count: number;
  unresolved_count: number;
  outstanding_count: number;
  computed_at: string;
};

export type TransferFunnelPage = {
  rows: TransferFunnelRow[];
  scope: string;
  computedAt: string | null;
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

  /**
   * The reconciliation funnel, one row per transfer.
   *
   * Precomputed server-side and read as a table, so this is an indexed read
   * rather than a count over sales. The `computedAt` stamp is part of the
   * answer: these figures are as of the last compute run, not as of now.
   */
  getTransferFunnel: (params: {
    limit?: number;
    filters?: {
      organizationId?: string;
      transferState?: string;
      salesRep?: string;
      outstandingOnly?: boolean;
      search?: string;
    };
  } = {}) => call<TransferFunnelPage>("data-center-read", "transfer_funnel", params),

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

/** A staged import batch, as the batches list shows it. */
export type ImportBatch = {
  id: string;
  filename: string | null;
  state: "staged" | "validated" | "dry_run" | "committed" | "rolled_back" | "failed";
  total_rows: number;
  valid_rows: number;
  rejected_rows: number;
  committed_rows: number;
  exception_rows: number;
  uploaded_at: string;
  dry_run_at: string | null;
  committed_at: string | null;
  last_error: string | null;
  partner_name: string | null;
  uploaded_by_name: string | null;
};

export type ImportRow = {
  id: string;
  row_number: number;
  status: "pending" | "valid" | "rejected" | "committed" | "exception";
  rejection_reason: string | null;
  exception_reason: string | null;
  stove_serial_no: string | null;
  corrected_serial: string | null;
  sale_id: string | null;
  raw: Record<string, string>;
};

export type DryRunSummary = {
  byStatus: Record<string, number>;
  stovesThatWouldSell: string[];
  note: string;
};

/**
 * Bulk import.
 *
 * Four deliberate steps rather than one upload button, because committing a
 * receipt backlog moves hundreds of stoves from available to sold and changes
 * the sales app's own inventory figures. Nobody should meet that by surprise.
 */
export const dataCenterImport = {
  /**
   * What the importer makes of a file's headers, before a byte is staged.
   *
   * Answers three questions the operator otherwise finds out too late: which
   * columns are understood, which are being ignored, and which required fields
   * nothing feeds.
   */
  inspect: (headers: string[]) =>
    call<{
      recognised: { header: string; field: string }[];
      unrecognised: string[];
      missingRequired: string[];
      mappableFields: string[];
      maxRows: number;
    }>("data-center-import", "inspect", { headers }),

  stage: (
    organizationId: string,
    filename: string,
    rows: Record<string, string>[],
    options: { columnMapping?: Record<string, string>; confirmDuplicate?: boolean } = {},
  ) =>
    call<{ batchId: string; totalRows: number }>("data-center-import", "stage", {
      organizationId,
      filename,
      rows,
      columnMapping: options.columnMapping ?? {},
      confirmDuplicate: options.confirmDuplicate ?? false,
    }),

  /**
   * One record, typed. A batch of one through the same four steps, so a
   * hand-keyed receipt is validated, dry-run and audited exactly like a file.
   */
  manualEntry: (organizationId: string, record: Record<string, string>) =>
    call<{ batchId: string; totalRows: number }>("data-center-import", "manual_entry", {
      organizationId,
      record,
    }),

  validate: (batchId: string) =>
    call<{
      valid: number;
      rejected: number;
      exception: number;
      linkedToTransfer: number;
    }>("data-center-import", "validate", { batchId }),

  /** Reports what a commit would change. Writes nothing to public. */
  dryRun: (batchId: string) =>
    call<DryRunSummary>("data-center-import", "dry_run", { batchId }),

  /** One slice. Call until `done`, so no single request runs long. */
  commit: (batchId: string) =>
    call<{
      committed: number;
      failed: number;
      remaining: number;
      done: boolean;
      failures: { rowId: string; reason: string }[];
    }>("data-center-import", "commit", { batchId }),

  /** Also sliced. Each sale goes back through delete-sale, which frees the stove. */
  rollback: (batchId: string) =>
    call<{ reversed: number; remaining: number; done: boolean }>(
      "data-center-import",
      "rollback",
      { batchId },
    ),

  resolveException: (rowId: string, correctedSerial: string) =>
    call<{ rowId: string; resolved: boolean; reason: string | null }>(
      "data-center-import",
      "resolve_exception",
      { rowId, correctedSerial },
    ),

  /** Partners this caller may import for. Scoped server-side. */
  partners: () =>
    call<{ id: string; partner_name: string }[]>("data-center-import", "partners"),

  batches: () => call<ImportBatch[]>("data-center-import", "batches"),

  rows: (batchId: string, status = "") =>
    call<ImportRow[]>("data-center-import", "rows", { batchId, status }),
};

export type Metric = {
  metric_key: string;
  dimension: Record<string, string>;
  value_num: string | number | null;
  value_text: string | null;
  run_finished_at: string;
};

export type DashboardData = {
  metrics: Metric[];
  computedAt: string | null;
  /** True when the newest run is older than metrics.stale_after_hours. */
  isStale: boolean;
  staleAfterHours: number;
  lastRun: { finished_at: string | null; status: string; duration_ms: number | null } | null;
};

export type MetricRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "failed";
  metrics_written: number;
  duration_ms: number | null;
  error: string | null;
};

/**
 * Dashboards.
 *
 * The read never aggregates. Every number came from a computation run, which
 * is what keeps a dashboard load flat at 2.3 ms whether the database holds 38
 * sales or 500,000.
 */
export const dataCenterDashboard = {
  get: () => call<DashboardData>("data-center-read", "dashboard"),

  /** Recent computation runs, so a dashboard can say how current it is. */
  runs: () => call<{ runs: MetricRun[] }>("data-center-compute", "status"),

  /** Recompute now. Super admin only: it reads every sale. */
  run: () =>
    call<{ runId: string; metricsWritten: number; durationMs: number }>(
      "data-center-compute",
      "run",
    ),
};

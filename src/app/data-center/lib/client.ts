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

/**
 * The three levels a user can be granted.
 *
 * The server holds the authoritative table in
 * `supabase/functions/_shared/data-center-roles.ts`, which is where a fourth
 * level would be added. This is the client's name for the same thing, so a
 * typo in a grant call is a compile error rather than a 400.
 */
export type AccessRole = "viewer" | "call_agent" | "editor";

export class DataCenterError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * Whatever the failure carried beyond its message.
   *
   * The import returns a `hint` on a refusal - what the person should actually
   * do about it - and this class used to drop it on the floor, so every hint
   * the server took care to write reached nobody. A failure that says only
   * what is wrong leaves the reader where they started.
   */
  readonly data: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    code = "unknown",
    data: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "DataCenterError";
    this.status = status;
    this.code = code;
    this.data = data;
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
      const detail = body as
        | { error?: string; code?: string; data?: Record<string, unknown> }
        | null;
      throw new DataCenterError(
        detail?.error ?? `Request to ${fn} failed.`,
        response.status,
        detail?.code ?? "request_failed",
        detail?.data ?? null,
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
  /** The granted level; null for super_admin, who outranks all three, and for the denied. */
  accessRole: AccessRole | null;
  /** Effective feature keys: what the level implies plus individual grants. */
  features: string[];
  /** True when the host role short-circuits every check, mirroring usePermissions. */
  isSuperAdmin: boolean;
  organizationId: string | null;
};

export type AccessListEntry = {
  user_id: string;
  access_role: AccessRole;
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
  current_access: AccessRole | null;
};

/** The parts of the module a tracked change can belong to. Server-derived. */
export type ChangeCategory =
  | "call_records"
  | "calls"
  | "documents"
  | "imports"
  | "assignment"
  | "access"
  | "configuration"
  | "other";

export type ChangeLogEntry = {
  id: string;
  table_name: string;
  record_pk: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_at: string;
  changed_by_name: string | null;
  category: ChangeCategory;
  /** Which columns actually moved. Empty for an insert or a delete. */
  changed_fields: string[];
};

/** The cursor is opaque to the client: it is handed back exactly as received. */
export type RecordsCursor = { salesDate: string | null; saleId: string };

export type RecordsFilters = {
  search?: string;
  organizationId?: string | null;
  userState?: string;
  /** Only offered once a state is chosen: the index leads with the state. */
  userLga?: string;
  /** public.payment_models.id, which the table displays as Model. */
  salesModel?: string;
  /** The profile that recorded the sale, shown as Sold by. */
  saleAgent?: string;
  /** The partner's own state, not the buyer's. Different question. */
  partnerState?: string;
  /** The rep on the parent transfer, resolved through the transaction. */
  transferSalesRep?: string;
  saleStatus?: string;
  paymentStatus?: string;
  /**
   * Call centre table only. `false` is "nobody has called this yet", which is
   * what the bulk call sheet offers: a record with an outcome already on it
   * would come back from the import refused rather than merged.
   */
  hasCallRecord?: boolean;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;
};

/** One record the call centre sent back, with everything needed to act on it. */
export type SendBackRow = {
  sale_id: string;
  stove_serial_no: string | null;
  transaction_id: string | null;
  correction_requested_at: string;
  correction_note: string | null;
  correction_reason: string | null;
  requested_by_name: string | null;
  organization_id: string | null;
  partner_name: string | null;
  transfer_reference: string | null;
  /** The rep as the ERP names them, which may be nobody's account. */
  sales_rep: string | null;
  sales_rep_user_id: string | null;
  sales_rep_marked_no_account: boolean | null;
  sales_rep_account_name: string | null;
  end_user_name: string | null;
  phone: string | null;
  sales_date: string | null;
  is_my_consignment: boolean;
};

/** The lists the filter panel offers. Small tables only - never a DISTINCT. */
export type RecordFacets = {
  /**
   * Branch and state travel with the name because the name alone does not
   * identify a partner. Four organizations are called LAPO and four Solar
   * Sister, and two of the Solar Sister rows are both "Main Branch", in Niger
   * and in FCT. A picker showing names only offers the same word four times.
   */
  partners: {
    id: string;
    name: string | null;
    partner_id: string | null;
    branch: string | null;
    state: string | null;
    transfers: number;
  }[];
  salesReps: { name: string; transfers: number }[];
  states: string[];
  lgasByState: Record<string, string[]>;
  salesModels: { id: string; name: string }[];
  salesAgents: { id: string; name: string }[];
  scope: string;
};

/** One row of a record's audit history. */
export type ChangeRow = {
  id: string;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  /** For display. Millisecond precision, because the driver returns a Date. */
  changed_at: string;
  /**
   * The same instant with its microseconds intact, as Postgres wrote it.
   *
   * The only value a cursor may be built from. `changed_at` has already lost
   * precision by the time it reaches here, and a cursor built from it skips
   * every row sharing its millisecond - which is every row a batch commit
   * wrote, since they all share a timestamp exactly.
   */
  cursor_at?: string;
  changed_by_name: string | null;
  changed_by_email: string | null;
  changed_fields: string[];
};

export type ChangeCursor = { changedAt: string; id: string };

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
  /**
   * How many records match, answered on the first page of a filter only.
   * Null on continuation pages, because the answer has not changed and a third
   * statement per page would undo the point of the two-statement read.
   */
  total: number | null;
  /** True means the total is a floor - "10,000+" rather than exactly 10,000. */
  totalIsCapped: boolean;
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

export type TransferFunnelFilters = {
  organizationId?: string;
  transferState?: string;
  salesRep?: string;
  outstandingOnly?: boolean;
  search?: string;
  /** The shared period control's output. YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  dateTo?: string;
};

export type TransferFunnelPage = {
  rows: TransferFunnelRow[];
  /**
   * Totals over every transfer the filters matched, not just this page.
   *
   * Summing `rows` was how the Issued figure on Partner Records came to be the
   * top 300 of 483 matching consignments while calling itself a total. These
   * are computed in SQL over the same predicate, so they cannot drift from the
   * rows underneath them.
   */
  totals: {
    transfers: number;
    issued: number;
    received: number;
    digitalised: number;
    verified: number;
    outstanding: number;
  };
  /** How many matched, against how many came back, so a page can say which. */
  matched: number;
  shown: number;
  limit: number;
  scope: string;
  computedAt: string | null;
};

let boundsCache: Promise<{
  earliest: string | null;
  earliestSale: string | null;
  earliestTransfer: string | null;
}> | null = null;

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
  /**
   * The lists behind the Stove Records filter panel.
   *
   * Fetched once when the panel mounts and held for the session. Every list
   * comes from a small table server-side, so this is cheap - but it is still
   * one request, not one per control.
   */
  recordFacets: () => call<RecordFacets>("data-center-read", "record_facets"),

  /**
   * A partner's stoves, rather than one consignment's.
   *
   * `period` is a month, matching every other Data Centre control. `search`
   * matches anywhere in the stove ID and runs on the server, which is the
   * point: the rail's own filter only ever saw the page it was handed, so a
   * stove that exists but is not loaded came back as "not found".
   */
  partnerStoves: (params: {
    organizationId: string;
    period?: string | null;
    search?: string | null;
    cursor?: string | null;
    limit?: number;
    /** "no" for still to type, "yes" for already recorded, null for both. */
    recorded?: string | null;
    /** One consignment reference, narrowing server-side like everything else. */
    transactionId?: string | null;
  }) =>
    call<{
      stoves: Record<string, unknown>[];
      hasMore: boolean;
      /** How many match the CURRENT filter, not how many were fetched. The bench pages on this. */
      total: number;
      /**
       * All three chips from the same scan. Counted whatever `recorded` asks
       * for, so "done" is a real number even while the page shows only todo.
       */
      totals: { all: number; todo: number; done: number };
      nextCursor: string | null;
      scope: string;
    }>("data-center-read", "partner_stoves", params),

  /**
   * The records sent back to Sales that this person is responsible for.
   *
   * Routing is worked out server-side from the standing recipient list and the
   * rep mapping as they stand now, so this is always current: linking a rep to
   * their account fixes every send-back already open, not just the next one.
   */
  sendBacks: (limit?: number) =>
    call<{
      rows: SendBackRow[];
      waiting: number;
      /** True for a data manager or a standing recipient: they see all of it. */
      seesEverything: boolean;
      /** Rep names with work waiting and no account to send it to. */
      unrouted: { sales_rep: string; waiting: number }[];
    }>("data-center-read", "send_backs", { limit }),

  /**
   * More of one record's edit history.
   *
   * The stove page arrives with the newest five from `stove_detail`; this is
   * what "show more" calls. Keyset paged, so it stays flat however long the
   * history is.
   */
  stoveChanges: (params: {
    saleId?: string | null;
    batchId?: string | null;
    limit?: number;
    cursor?: ChangeCursor | null;
  }) =>
    call<{ rows: ChangeRow[]; hasMore: boolean; nextCursor: ChangeCursor | null }>(
      "data-center-read",
      "stove_changes",
      params,
    ),

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

  /**
   * The sheet the digitisers work from: one row per transferred stove, already
   * carrying the serial and the transfer reference so neither is typed.
   */
  /**
    * The sheet for one partner, or for every partner the caller holds.
    *
    * An empty `organizationId` means everything. The import resolves each row's
    * partner from its stove ID, so a sheet spanning partners lands correctly
    * and somebody working a stack of receipts from several partners no longer
    * downloads several files and reconciles them by hand.
    */
  digitisationSheet: (organizationId: string, month?: string | null) =>
    call<{
      rows: {
        stove_id: string;
        transaction_id: string;
        partner_name: string;
        /** The unique one. Names are shared across branches; this is not. */
        partner_id: string | null;
        sales_rep: string | null;
        sales_date: string | null;
        transfer_state: string | null;
        transfer_branch: string | null;
        stock_status: string | null;
        already_recorded: boolean;
      }[];
      months: { month: string; transfers: number }[];
      /** The sheet's columns, from workflow_config. Editable in Settings. */
      columns: {
        field: string;
        header: string;
        required?: boolean;
        locked?: boolean;
        type?: string;
        options?: string[];
        optionList?: string;
        help?: string;
      }[];
      format: "xlsx" | "csv";
    }>("data-center-read", "digitisation_sheet", { organizationId, month: month ?? undefined }),

  /** One partner opened up: its batches, and each rep's totals. */
  partnerDetail: (organizationId: string) =>
    call<{
      partner: {
        organization_id: string;
        partner_name: string;
        partner_id: string | null;
        transfer_state: string | null;
        transfer_branch: string | null;
      } | null;
      batches: PartnerBatch[];
      reps: PartnerRep[];
    }>("data-center-read", "partner_detail", { organizationId }),

  /** Every stove in one batch, sold or not, assigned or not. */
  batchStoves: (transferId: string) =>
    call<{ stoves: BatchStove[] }>("data-center-read", "batch_stoves", { transferId }),

  /**
   * One stove, everything.
   *
   * The whole of it: where the ERP issued it, the transfer that sent it to a
   * partner, the sale it became, who typed that sale up and from which file,
   * the call centre's own additions, every call anybody made, and every field
   * anybody has edited since. Nine tables, one request, because a person
   * holding a serial is asking one question.
   */
  stoveDetail: (stoveId: string) =>
    call<StoveRecord>("data-center-read", "stove_detail", { stoveId }),

  /**
   * Find a stove by its ID, or a whole transfer by its reference.
   *
   * Two anchors because two things get written on paper. An exact serial is an
   * answer and the caller should navigate straight to it; anything else is a
   * shortlist.
   */
  stoveSearch: (query: string) =>
    call<StoveSearchResult>("data-center-read", "stove_search", { query }),

  /**
   * Every phone number carrying more than one stove, with the records.
   *
   * The records rather than a count, because a count cannot tell a household
   * from a typo and the whole point of the surface is that somebody decides
   * which it is.
   */
  sharedPhones: (params: { search?: string; confirmedOnly?: boolean; limit?: number } = {}) =>
    call<{ rows: SharedPhoneGroup[] }>("data-center-read", "shared_phones", params),

  /**
   * The earliest date the module knows about, so the period control offers
   * only years the register actually holds.
   *
   * Cached for the session: it moves once, when the oldest record is older
   * than the oldest record, and asking on every page is a request whose answer
   * is the same every time.
   */
  periodBounds: () => {
    boundsCache ??= call<{
      earliest: string | null;
      earliestSale: string | null;
      earliestTransfer: string | null;
    }>("data-center-read", "period_bounds", {}).catch((err) => {
      // A failed lookup must not poison the session: clear it so the next
      // caller retries rather than inheriting the rejection forever.
      boundsCache = null;
      throw err;
    });
    return boundsCache;
  },


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
/**
 * Everything one stove ID anchors.
 *
 * Kept loose on purpose. The sale carries whatever columns public.sales
 * carries, and the call centre's `answers` carry whatever questions the
 * registry currently asks - both change without a release, and a type that
 * enumerated them would be wrong the first time somebody adds a question.
 * What is named here is only the structure the page navigates by.
 */
export type StoveRecord = {
  stove: Record<string, unknown>;
  attempts: Record<string, unknown>[];
  sale: Record<string, unknown> | null;
  enrichment: Record<string, unknown> | null;
  provenance: Record<string, unknown>[];
  /**
   * The instalments behind `sale.total_paid`, newest first.
   *
   * Named rather than left loose because the page reconciles them against the
   * sale's own total and has to be able to add them up. Empty for an outright
   * sale, and empty is also a real answer for an instalment sale nobody has
   * recorded a payment against - which production has two of.
   */
  payments: {
    id: string;
    amount: number | string | null;
    payment_method: string | null;
    payment_date: string | null;
    notes: string | null;
    created_at: string | null;
    proof_url: string | null;
    recorded_by_name: string | null;
  }[];
  /**
   * Sales this stove used to have, newest first. Nearly always a cancellation.
   *
   * Found by serial rather than through `stove_ids_base.sale_id`, because
   * cancelling a sale drops that link: the stove goes back to available and
   * every other part of the record loses sight of what happened to it.
   */
  pastSales: {
    id: string;
    transaction_id: string | null;
    sales_date: string | null;
    end_user_name: string | null;
    phone: string | null;
    amount: number | string | null;
    total_paid: number | string | null;
    payment_status: string | null;
    is_archived: boolean | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    cancelled_by_name: string | null;
    created_by_name: string | null;
  }[];
  /** The newest few only. `stoveChanges` fetches the rest on request. */
  changes: ChangeRow[];
  changesHasMore: boolean;
  changesTotal: number;
  consignment: Record<string, unknown>[];
  /**
   * Any other live sale carrying this buyer's phone number.
   *
   * One stove to one phone is the rule, and create-sale enforces it, so this
   * is empty in a healthy register. It is carried anyway so the record can
   * show a violation rather than leave it to be discovered by a call agent
   * ringing a number that answers about a different stove.
   */
  phoneTwins: {
    stove_id: string | null;
    stove_serial_no: string | null;
    transaction_id: string | null;
    end_user_name: string | null;
    sales_date: string | null;
    phone: string | null;
  }[];
  siblings: { total: number; sold: number } | null;
};

export type StoveSearchResult = {
  /** "stove" is an exact hit and should be opened, not listed. */
  kind: "stove" | "matches" | "none";
  stoveId: string | null;
  transfers: {
    transfer_id: string;
    transaction_id: string;
    partner_name: string | null;
    organization_id: string;
    sales_rep: string | null;
    sales_date: string | null;
    issued_count: number;
    digitalised_count: number;
    verified_count: number;
  }[];
  stoves: {
    stove_id: string;
    stock_status: string | null;
    partner_name: string | null;
    transaction_id: string | null;
    sold: boolean;
  }[];
};

/** One phone number and every stove recorded against it. */
export type SharedPhoneGroup = {
  phone_tail: string;
  stove_count: number;
  any_confirmed: boolean;
  first_seen: string;
  last_touched: string;
  stoves: {
    sale_id: string;
    stove_id: string | null;
    phone_as_written: string | null;
    source: "digitalisation" | "call_centre" | "sales_app";
    confirmed: boolean;
    note: string | null;
    buyer: string | null;
    address: string | null;
    lga: string | null;
    partner: string | null;
    sales_date: string | null;
    recorded_by: string | null;
    recorded_at: string;
  }[];
};

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
/**
 * A call form somebody stopped part way through.
 *
 * Keyed by the sale rather than by the agent, deliberately: records move
 * between agents when a batch is reassigned or reclaimed, and a draft keyed to
 * whoever typed it would be stranded every time that happened - which is
 * exactly the work it exists to stop losing. `saved_by_name` is carried so
 * whoever opens it next is told whose it is instead of quietly inheriting
 * somebody else's half-answers.
 */
export type CallDraft = {
  values: Record<string, unknown>;
  /**
   * The call_records.version this was typed against, null if the record did
   * not exist yet. Compared on open, so a record that moved on in the meantime
   * can be reported rather than silently overwritten.
   */
  base_version: number | null;
  saved_at: string;
  saved_by_name: string | null;
  saved_by_me: boolean;
};

export const dataCenterWrite = {
  /** The questionnaire's definition. Fetched, never bundled. */
  formSchema: () => call<FormSchema>("data-center-write", "form_schema"),

  callRecord: (saleId: string) =>
    call<{
      record: Record<string, unknown>;
      attempts: CallAttempt[];
      /** What somebody left half-finished here, or null. */
      draft: CallDraft | null;
    }>("data-center-write", "call_record", { saleId }),

  /**
   * Keep a half-finished call form.
   *
   * Sent as the agent types, debounced, and again when they close deliberately.
   * Nothing here is validated: a half-finished form fails validation by
   * definition, and refusing to keep it would be refusing the only thing this
   * is for. `saveCallRecord` is still the only door to the record itself, and
   * it clears the draft as part of the same transaction.
   *
   * An empty `values` deletes the draft rather than storing an empty one, so
   * clearing the last field takes the record off the unfinished list.
   */
  saveCallDraft: (
    saleId: string,
    values: Record<string, unknown>,
    baseVersion: number | null,
  ) =>
    call<{ saleId: string; kept: boolean; savedAt?: string; cleared?: boolean }>(
      "data-center-write",
      "save_call_draft",
      { saleId, values, baseVersion },
    ),

  /** Throw a draft away and start the form again. */
  discardCallDraft: (saleId: string) =>
    call<{ saleId: string; discarded: boolean }>(
      "data-center-write",
      "discard_call_draft",
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

/** One choice behind a dropdown, as Settings edits it. */
export type RegistryOptionValue = {
  id: string;
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export type RegistryOptionList = {
  key: string;
  label: string;
  description: string | null;
  values: RegistryOptionValue[];
};

/** One question on the call form, as Settings edits it. */
export type RegistryField = {
  key: string;
  label: string;
  section: string;
  input_type: string;
  option_list_key: string | null;
  storage: "answers" | "column";
  column_name: string | null;
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
  help_text: string | null;
  visible_when: { field?: string; in?: string[] } | null;
  validation: Record<string, unknown> | null;
  retired_at: string | null;
};

export type WorkflowSetting = {
  key: string;
  value: unknown;
  description: string | null;
};

/** One transfer a partner received, as the partner drill lists it. */
export type PartnerBatch = {
  transfer_id: string;
  transaction_id: string;
  organization_id: string;
  partner_name: string;
  partner_id: string | null;
  transfer_state: string | null;
  transfer_branch: string | null;
  sales_rep: string | null;
  sales_date: string | null;
  transfer_date: string | null;
  issued_count: number;
  received_count: number;
  digitalised_count: number;
  verified_count: number;
  unverified_count: number;
  unreachable_count: number;
  unresolved_count: number;
  outstanding_count: number;
};

/** A rep's totals, for this partner and across every partner. */
export type PartnerRep = {
  sales_rep: string;
  stoves_here: number;
  batches_here: number;
  stoves_total: number;
  partners_total: number;
};

/** One stove inside a batch, with what has become of it. */
export type BatchStove = {
  stove_id: string;
  transaction_id: string;
  stock_status: string | null;
  sale_id: string | null;
  sales_date: string | null;
  end_user_name: string | null;
  phone: string | null;
  user_state: string | null;
  verification_outcome: string | null;
  attempt_count: number | null;
  agent_id: string | null;
  agent_name: string | null;
  batch_state: string | null;
};

/** Access administration. Server-gated to super_admin or grants.manage. */
/**
 * The two acts only the agent on the call can perform.
 *
 * Both live on the write endpoint beside the call record, because both are
 * things a person does while holding a phone: the buyer reads a stove number
 * that does not match, or gives a number somebody else is already on.
 */
export const dataCenterCall = {
  /**
   * Move this sale onto the stove ID the buyer read out.
   *
   * Answers with what happened rather than just success: claiming a free stove
   * and swapping with another buyer are the same request and very different
   * outcomes, and the second one leaves somebody else needing a call.
   */
  serialRematch: (saleId: string, confirmedSerial: string, note?: string) =>
    call<{
      saleId: string;
      fromSerial: string;
      toSerial: string;
      kind: "claimed_available" | "swapped";
      swappedWithSaleId: string | null;
    }>("data-center-write", "serial_rematch", { saleId, confirmedSerial, note }),

  /** Put this number and every stove on it into the register. */
  recordSharedPhone: (saleId: string, phone: string, note?: string) =>
    call<{ phoneTail: string; stoves: { sale_id: string; stove_serial_no: string | null }[] }>(
      "data-center-write",
      "record_shared_phone",
      { saleId, phone, note },
    ),
};

export type SendBackConfig = {
  recipients: {
    user_id: string;
    is_enabled: boolean;
    note: string | null;
    added_at: string;
    full_name: string | null;
    email: string | null;
    role: string | null;
    added_by_name: string | null;
  }[];
  /** Every rep name the ERP has written, heaviest first. */
  reps: {
    rep_key: string;
    rep_name: string;
    transfers: number;
    user_id: string | null;
    no_account: boolean | null;
    linked_at: string | null;
    account_name: string | null;
    account_email: string | null;
    /**
     * Whether that account can actually open a send-back.
     *
     * Linking grants nothing on purpose - a routing screen that handed out
     * module access would be a door into the module that does not look like
     * one - so "linked" and "can see it" are reported apart.
     */
    account_can_see: boolean;
    account_access_role: string | null;
    linked_by_name: string | null;
    waiting: number;
  }[];
  candidates: { id: string; full_name: string; email: string | null; role: string }[];
};

export const dataCenterAdmin = {
  listAccess: () => call<AccessListEntry[]>("data-center-admin", "access_list"),

  /**
   * Everything the send-back settings screen needs, in one answer.
   *
   * Three lists that are only useful together: who receives send-backs today,
   * every rep name the ERP has written with the weight of work behind it, and
   * the accounts a rep could be linked to.
   */
  sendBackConfig: () => call<SendBackConfig>("data-center-admin", "send_back_config"),

  /**
   * Put somebody on the standing list, or take them off it.
   *
   * `enabled: null` removes them outright; `false` disables, which is what
   * somebody on leave needs - they stop receiving without anybody having to
   * remember who was on the list before they left.
   */
  sendBackRecipientSet: (userId: string, enabled: boolean | null, note?: string) =>
    call<{ userId: string; removed?: boolean; is_enabled?: boolean }>(
      "data-center-admin",
      "send_back_recipient_set",
      { userId, enabled, note },
    ),

  /**
   * Say which account a rep name means, or that it means nobody.
   *
   * `noAccount` is not a failure state: the ERP has written values into this
   * field - a town, a state, two system logins - that no account will ever
   * correspond to, and marking them is what stops them being re-examined
   * every time somebody opens the screen.
   */
  salesRepLink: (repKey: string, userId: string | null, noAccount = false) =>
    call<{ rep_key: string; user_id: string | null; no_account: boolean }>(
      "data-center-admin",
      "sales_rep_link",
      { repKey, userId, noAccount },
    ),
  searchUsers: (query: string) =>
    call<UserSearchResult[]>("data-center-admin", "user_search", { query }),
  grantAccess: (userId: string, accessRole: AccessRole) =>
    call("data-center-admin", "access_grant", { userId, accessRole }),
  /** The call form as data: every dropdown and every question. */
  registryRead: () =>
    call<{ lists: RegistryOptionList[]; fields: RegistryField[]; canEdit: boolean }>(
      "data-center-admin",
      "registry_read",
    ),
  upsertOptionList: (list: { key: string; label: string; description?: string | null }) =>
    call<{ key: string }>("data-center-admin", "option_list_upsert", { list }),
  upsertOptionValue: (value: {
    listKey: string;
    /** Present when editing. Absent creates, keyed on (listKey, value). */
    id?: string;
    value?: string;
    label: string;
    sortOrder?: number;
    isActive?: boolean;
  }) => call<{ id: string }>("data-center-admin", "option_value_upsert", { value }),
  upsertField: (field: {
    key: string;
    label: string;
    section: string;
    inputType: string;
    optionListKey?: string | null;
    sortOrder?: number;
    isRequired?: boolean;
    isActive?: boolean;
    helpText?: string | null;
    visibleWhen?: { field: string; in: string[] } | null;
  }) => call<{ key: string }>("data-center-admin", "field_def_upsert", { field }),

  /** The runtime numbers every rule reads: batch size, callback limit, caps. */
  configRead: () =>
    call<{ config: WorkflowSetting[]; canEdit: boolean }>("data-center-admin", "config_read"),
  configSet: (key: string, value: unknown) =>
    call<{ key: string }>("data-center-admin", "config_set", { config: { key, value } }),

  /** Tier-2 features, ticked on per user on top of their level. */
  featureGrants: () =>
    call<{ user_id: string; feature_key: string }[]>("data-center-admin", "feature_grants_list"),
  setFeatureGrant: (userId: string, featureKey: string, granted: boolean) =>
    call("data-center-admin", "feature_grant_set", { userId, featureKey, granted }),

  revokeAccess: (userId: string) =>
    call("data-center-admin", "access_revoke", { userId }),
  changeLog: (limit = 25, category: ChangeCategory | "all" = "all") =>
    call<ChangeLogEntry[]>("data-center-admin", "change_log", { limit, category }),
};

export default dataCenterClient;

/** A staged import batch, as the batches list shows it. */
export type ImportBatch = {
  id: string;
  filename: string | null;
  state: "staged" | "validated" | "dry_run" | "committed" | "rolled_back" | "failed";
  /** True while a commit chain holds this batch's lease on the server. */
  committing: boolean;
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
  /** Only for a batch with no single partner: how many it covers. */
  partner_count?: number | null;
  uploaded_by_name: string | null;
};

export type ImportRow = {
  /** What we understood the row to say, beside `raw` which is what was typed. */
  normalized?: Record<string, unknown> | null;
  /** Stoves already on this row's phone number. Amber, never a block. */
  shared_phone_with?: string[] | null;
  id: string;
  row_number: number;
  status: "pending" | "valid" | "rejected" | "committed" | "exception";
  rejection_reason: string | null;
  /** What to do about it. A reason without a fix is a row that gets skipped. */
  rejection_hint: string | null;
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

  /**
   * Stage a file. `organizationId` is null for an upload: the stove IDs name
   * the partner, and the server answers with the one it resolved. Manual entry
   * still passes one, because a typed record has no file to read it from.
   */
  stage: (
    organizationId: string | null,
    filename: string,
    rows: Record<string, string>[],
    options: { columnMapping?: Record<string, string>; confirmDuplicate?: boolean } = {},
  ) =>
    call<{
      batchId: string;
      totalRows: number;
      resolvedPartner: {
        /** Every partner the file turned out to cover, with a row count each. */
        partners?: {
          organizationId: string;
          partnerName: string | null;
          /** Two branches of one partner share a name; this is what separates them. */
          branch?: string | null;
          count: number;
        }[];
        organizationId: string;
        partnerName: string | null;
        matched: number;
        unmatched: number;
        mismatches: { serial: string; fileRef: string; stockRef: string }[];
      } | null;
    }>("data-center-import", "stage", {
      organizationId: organizationId ?? undefined,
      filename,
      rows,
      columnMapping: options.columnMapping ?? {},
      confirmDuplicate: options.confirmDuplicate ?? false,
    }),

  /**
   * One record, typed. A batch of one through the same four steps, so a
   * hand-keyed receipt is validated, dry-run and audited exactly like a file.
   */
  /** `organizationId` is optional: the stove serial in the record names it. */
  manualEntry: (organizationId: string | null, record: Record<string, string>) =>
    call<{ batchId: string; totalRows: number }>("data-center-import", "manual_entry", {
      organizationId: organizationId || undefined,
      record,
    }),

  /** Open one stove for typing: who it belongs to, and any work already on it. */
  workbenchOpen: (stoveId: string) =>
    call<{
      stove: {
        stoveId: string;
        organizationId: string | null;
        partnerName: string | null;
        transactionId: string | null;
        stockStatus: string | null;
        alreadySold: boolean;
      };
      work: {
        id: string;
        status: string;
        draft_values: Record<string, unknown> | null;
        normalized: Record<string, unknown> | null;
        rejection_reason: string | null;
        rejection_hint: string | null;
        confirmed_at: string | null;
        sale_id: string | null;
        last_edited_at: string | null;
        last_edited_by_name: string | null;
        batch_id: string;
        owner_id: string;
      } | null;
    }>("data-center-import", "workbench_open", { stoveId }),

  /**
   * Save what has been typed. `complete` is the typist saying they are done;
   * a draft is never judged, so half-typed work is never rejected.
   */
  workbenchSave: (stoveId: string, values: Record<string, unknown>, complete: boolean) =>
    call<{ batchId: string; stoveId: string; status: "draft" | "valid" }>(
      "data-center-import",
      "workbench_save",
      { stoveId, values, complete },
    ),

  /** What this person has on the bench, and what others have abandoned. */
  workbenchQueue: () =>
    call<{
      mine: {
        stove_serial_no: string;
        status: string;
        last_edited_at: string;
        draft_values: Record<string, unknown> | null;
        organization_id: string;
        partner_name: string | null;
        rejection_reason: string | null;
        rejection_hint: string | null;
      }[];
      abandoned: {
        stove_serial_no: string;
        last_edited_at: string;
        last_edited_by_name: string | null;
        partner_name: string | null;
      }[];
      staleDays: number;
    }>("data-center-import", "workbench_queue"),

  /** Both input streams, with what is waiting on somebody to release it. */
  awaitingConfirmation: () =>
    call<{
      batches: {
        batch_id: string;
        stream: "bulk_import" | "workbench";
        source: string;
        filename: string | null;
        organization_id: string | null;
        partner_name: string | null;
        uploaded_at: string;
        uploaded_by_name: string | null;
        awaiting: number;
        still_drafting: number;
        refused: number;
        exceptions: number;
        confirmed: number;
        total_rows: number;
        last_worked_on: string | null;
        worked_by: string[];
      }[];
    }>("data-center-import", "awaiting_confirmation"),

  validate: (batchId: string) =>
    call<{
      valid: number;
      rejected: number;
      exception: number;
      /** Rows that will land but carry something worth reading first. */
      noted?: number;
      linkedToTransfer: number;
    }>("data-center-import", "validate", { batchId }),

  /** Reports what a commit would change. Writes nothing to public. */
  dryRun: (batchId: string) =>
    call<DryRunSummary>("data-center-import", "dry_run", { batchId }),

  /** One slice. Call until `done`, so no single request runs long. */
  /**
   * Kick the commit chain. One press is the whole ask: the server answers in
   * about a second and then works the batch link by link on its own -
   * EdgeRuntime.waitUntil carries each slice past its response, and each link
   * fires the next. Progress is read by polling `batches({ batchId })`, whose
   * `committing` flag is the server's lease.
   *
   * `busy` means a chain already holds the batch - which the panel treats as
   * "watch it", never as an error. `done` comes back only when there was
   * nothing left to do at all.
   */
  commit: (batchId: string) =>
    call<{
      started?: boolean;
      link?: number;
      claimed?: number;
      remaining?: number;
      busy?: boolean;
      state?: string;
      done?: boolean;
      committed?: number;
      stopped?: string;
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

  /**
   * Clear away a staging batch that never became sales.
   *
   * Removes staging state only - the server refuses outright if any row holds
   * a sale, because undoing sales is rollback's job and it does it through
   * delete-sale so each stove is released properly.
   */
  discard: (batchId: string) =>
    call<{ discarded: boolean; rows: number; drafts: number; filename: string | null }>(
      "data-center-import",
      "discard",
      { batchId },
    ),

  /**
   * Clear away a staging batch that never became sales.
   *
   * Removes staging state only - the server refuses outright if any row holds
   * a sale, because undoing sales is rollback's job and it does it through
   * delete-sale so each stove is released properly.
   */
  discard: (batchId: string) =>
    call<{ discarded: boolean; rows: number; drafts: number; filename: string | null }>(
      "data-center-import",
      "discard",
      { batchId },
    ),

  /** Partners this caller may import for. Scoped server-side. */
  partners: () =>
    call<{ id: string; partner_name: string }[]>("data-center-import", "partners"),

  /**
   * The history, narrowed by the shared period control on upload date - or
   * one batch by id, which is what the commit progress poll asks every few
   * seconds. Counting the rows of two hundred batches to answer for one is
   * how a progress bar becomes load.
   */
  batches: (range: { dateFrom?: string; dateTo?: string; batchId?: string } = {}) =>
    call<ImportBatch[]>("data-center-import", "batches", range),

  /** Every stove in this batch that shares a phone number with another. */
  sharedPhoneRows: (batchId: string) =>
    call<ImportRow[]>("data-center-import", "rows", { batchId, sharedOnly: true }),

  rows: (batchId: string, status = "") =>
    call<ImportRow[]>("data-center-import", "rows", { batchId, status }),

  /*
   * The call-centre sheet.
   *
   * Kept beside the receipt import because it is the same act - a spreadsheet
   * filled in away from the app and brought back - even though what it writes
   * is a call record rather than a sale. The four steps are separate for the
   * same reason the receipt ones are: a person should be able to see what a
   * commit would do before it does it.
   */
  callSheet: () => call<CallSheetSpec>("data-center-import", "call_sheet"),

  callStage: (rows: Record<string, unknown>[], filename: string) =>
    call<{ batchId: string; staged: number }>("data-center-import", "call_stage", {
      rows,
      filename,
    }),

  callValidate: (batchId: string) =>
    call<{ total: number; valid: number; exceptions: number; rejected: number }>(
      "data-center-import",
      "call_validate",
      { batchId },
    ),

  callCommit: (batchId: string) =>
    call<{
      committed: number;
      failed: number;
      remaining: number;
      done: boolean;
      failures: { rowId: string; reason: string }[];
    }>("data-center-import", "call_commit", { batchId }),

  callRollback: (batchId: string) =>
    call<{ reversed: number; remaining: number; done: boolean }>(
      "data-center-import",
      "call_rollback",
      { batchId },
    ),
};

/** The call sheet's columns, plus the questions the registry currently asks. */
export type CallSheetSpec = {
  format: string;
  columns: {
    field: string;
    header: string;
    locked?: boolean;
    required?: boolean;
    type?: string;
    optionList?: string;
    choices?: { value: string; label: string }[];
    help?: string;
  }[];
  questions: {
    key: string;
    label: string;
    input_type: string;
    option_list_key: string | null;
  }[];
};

/** One row of the assignment log: a record, who was given it, what came of it. */
export type AssignmentLogRow = {
  batch_id: string;
  organization_id: string;
  partner_name: string;
  agent_id: string;
  agent_name: string | null;
  assigned_at: string;
  batch_state: "open" | "completed" | "reclaimed";
  batch_size: number;
  last_activity_at: string;
  reclaimed_at: string | null;
  reclaim_reason: string | null;
  sale_id: string;
  position: number;
  is_active: boolean;
  stove_serial_no: string;
  sales_date: string | null;
  verification_outcome: string | null;
  call_outcome: string | null;
  attempt_count: number | null;
  number_on_record: string | null;
  last_attempt_at: string | null;
  last_attempt_outcome: string | null;
  last_attempt_by: string | null;
};

export type AssignmentLogCursor = {
  assignedAt: string;
  batchId: string;
  position: number;
};

/** One call agent, with what they are currently holding. */
export type AssignmentAgent = {
  agent_id: string;
  full_name: string | null;
  email: string | null;
  app_role: string | null;
  access_role: string;
  is_enabled: boolean;
  max_open_batches: number | null;
  open_batches: number;
  records_held: number;
  last_activity_at: string | null;
};

/** One partner with work still waiting. */
export type AssignmentPoolPartner = {
  organization_id: string;
  partner_name: string;
  callable: number;
  oldest: string | null;
};

/** One assigned record, as the console drills into it. */
export type AssignmentDetailItem = {
  batch_id: string;
  organization_id: string;
  partner_name: string;
  assigned_at: string;
  batch_size: number;
  last_activity_at: string;
  sale_id: string;
  position: number;
  stove_serial_no: string;
  sales_date: string | null;
  number_on_record: string | null;
  verification_outcome: string | null;
  call_outcome: string | null;
  attempt_count: number | null;
};

/**
 * The assignment engine's doorway.
 *
 * The engine itself is data_center.assign_batches(), in SQL under an advisory
 * lock. run and reclaim are administrative; status feeds a management view;
 * my_batches is the one action an agent calls, scoped to their token with no
 * way to ask about anyone else.
 */
export const dataCenterAssign = {
  run: () =>
    call<{
      reclaimed: number;
      batches: { batch_id: string; agent_id: string; organization_id: string; size: number }[];
    }>("data-center-assign", "run"),

  reclaim: () => call<{ reclaimed: number }>("data-center-assign", "reclaim"),

  /**
   * The console's read: who can take work, and what work there is.
   *
   * Both in one call, because assigning is choosing one of each and two round
   * trips would only ever be two round trips.
   */
  agents: () =>
    call<{
      agents: AssignmentAgent[];
      pool: AssignmentPoolPartner[];
      batchSize: number;
    }>("data-center-assign", "agents"),

  /** One agent opened up: every batch they hold and every record in it. */
  agentDetail: (agentId: string) =>
    call<{ items: AssignmentDetailItem[] }>("data-center-assign", "agent_detail", { agentId }),

  /** Hand one partner's records to one agent. `size` defaults to the configured batch. */
  assignManual: (agentId: string, organizationId: string, size?: number) =>
    call<{ batchId: string | null; size: number }>("data-center-assign", "assign_manual", {
      agentId,
      organizationId,
      size,
    }),

  unassignBatch: (batchId: string, reason?: string) =>
    call<{ released: number }>("data-center-assign", "unassign_batch", { batchId, reason }),

  /**
   * Move work from one agent to another without it passing through the pool.
   *
   * A batch when somebody is covering a whole shift, a list of sales when the
   * complaint is about particular records. Never both: the server would have
   * to decide which one you meant.
   */
  reassign: (
    toAgentId: string,
    what: { batchId: string } | { saleIds: string[] },
  ) =>
    call<{ moved: number; toAgentId: string; batches: string[]; closedEmpty: number }>(
      "data-center-assign",
      "reassign",
      { toAgentId, ...what },
    ),

  unassignItem: (saleId: string) =>
    call<{ batchId: string | null }>("data-center-assign", "unassign_item", { saleId }),

  status: () =>
    call<{
      pool: { organization_id: string; partner_name: string; callable: number }[];
      open: {
        batch_id: string; organization_id: string; partner_name: string;
        agent_id: string; agent_name: string | null; assigned_at: string;
        size: number; last_activity_at: string; remaining: number;
      }[];
    }>("data-center-assign", "status"),

  myBatches: () =>
    call<{
      items: {
        batch_id: string; partner_name: string; assigned_at: string; batch_size: number;
        sale_id: string; position: number; stove_serial_no: string; sales_date: string | null;
        verification_outcome: string | null; attempt_count: number | null;
        last_attempt_at: string | null;
        /** Resolved: a correction typed on an earlier call, else the receipt. */
        end_user_name: string | null;
        phone: string | null;
        alternative_phone: string | null;
        user_state: string | null;
        user_lga: string | null;
        correction_state: string | null;
        /** Set when another caller's rematch took this record's stove ID. */
        serial_unconfirmed_at: string | null;
      }[];
    }>("data-center-assign", "my_batches"),

  /** The log. Keyset paginated; pass back `nextCursor` for the next page. */
  log: (options: {
    limit?: number;
    cursor?: AssignmentLogCursor | null;
    filters?: {
      organizationId?: string;
      agentId?: string;
      batchState?: string;
      outcome?: string;
      dateFrom?: string;
      dateTo?: string;
    };
  } = {}) =>
    call<{
      rows: AssignmentLogRow[];
      scope: string;
      nextCursor: AssignmentLogCursor | null;
    }>("data-center-read", "assignment_log", {
      limit: options.limit ?? 50,
      cursor: options.cursor ?? undefined,
      filters: options.filters ?? {},
    }),
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
  /**
   * The families that can answer for a period at all.
   *
   * Sent by the server rather than listed here, because the list is a property
   * of what compute_metrics writes and a copy kept in the client would go stale
   * the first time a family gains or loses a period. A card whose key is absent
   * shows an all-time figure however the page is narrowed, and says so.
   */
  periodicKeys: string[];
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
  /**
   * `from` and `to` are months, not dates, because the metrics behind this
   * page are stored at month grain and a range is a sum of months. Omitting
   * both asks for all time, which is what this page could only ever show
   * before the metrics carried a period.
   */
  get: (range?: { from?: string | null; to?: string | null }) =>
    call<DashboardData>("data-center-read", "dashboard", {
      ...(range?.from ? { from: range.from } : {}),
      ...(range?.to ? { to: range.to } : {}),
    }),

  /** Recent computation runs, so a dashboard can say how current it is. */
  runs: () => call<{ runs: MetricRun[] }>("data-center-compute", "status"),

  /** Recompute now. Super admin only: it reads every sale. */
  run: () =>
    call<{ runId: string; metricsWritten: number; durationMs: number }>(
      "data-center-compute",
      "run",
    ),
};

/**
 * The Analysis area.
 *
 * `totals` is the requested range collapsed, with `period` stripped from the
 * dimension: what the cross-tabs and the funnel draw. `series` keeps the month
 * but drops the first axis: what the trend lines draw. Two shapes because two
 * things are being drawn, and keeping partner AND month AND bucket in one
 * payload would be the full cross product for the sake of a twelve-point line.
 *
 * The bands travel with the data. A chart colours a bar from `severity` in
 * `workflow_config`, never from a threshold it holds itself, because a limit
 * re-graded in Settings has to move the chart or it is not configuration.
 */
export type AnalysisDimension = {
  by?: string;
  key?: string;
  label?: string;
  ord?: number | null;
  by2?: string;
  key2?: string;
  label2?: string;
  ord2?: number | null;
  period?: string;
};

export type AnalysisRow = {
  metric_key: string;
  dimension: AnalysisDimension;
  value_num: number | null;
};

export type AnalysisSeriesRow = {
  metric_key: string;
  by: string | null;
  by2: string | null;
  key2: string | null;
  label2: string | null;
  ord2: number | null;
  period: string;
  value_num: number | null;
};

/** A configured band. `min_days` is derived server-side from the band below. */
export type AnalysisBand = {
  ord: number;
  code: string;
  label: string;
  severity: "ok" | "warning" | "critical";
  min_days: number;
  max_days: number | null;
};

export type AnalysisData = {
  totals: AnalysisRow[];
  series: AnalysisSeriesRow[];
  /** Every month the current run holds, oldest first. Drives the range picker. */
  months: string[];
  stockBands: AnalysisBand[];
  velocityBands: AnalysisBand[];
  from: string | null;
  to: string | null;
  computedAt: string | null;
  isStale: boolean;
  staleAfterHours: number;
  lastRun: {
    finished_at: string | null;
    status: string;
    duration_ms: number | null;
  } | null;
};

export const dataCenterAnalysis = {
  /**
   * Bounds are months (`2026-08`), not dates, and both are optional: with
   * neither, the answer covers everything the run holds.
   */
  get: (from?: string | null, to?: string | null) =>
    call<AnalysisData>("data-center-read", "analysis", {
      from: from ?? null,
      to: to ?? null,
    }),
};


/**
 * Unsold stock sitting at a partner: what the ageing chart drills into.
 *
 * A separate population from `records`, not a narrower one. Every records view
 * begins `from public.sales`, and a stove that has not been sold has no row
 * there, so no filter could ever have reached these.
 */
export type StockRow = {
  stove_id: string;
  organization_id: string;
  partner_name: string;
  transaction_id: string | null;
  factory: string | null;
  status: string;
  state: string | null;
  /** The date the consignment went out, as text. Never through a JS Date. */
  transferred_on: string | null;
  days: number;
};

export type StockCursor = { transferredOn: string | null; stoveId: string };

export type StockFilters = {
  organizationId?: string;
  /** A band CODE from workflow_config, resolved server-side against the same
   *  function compute bucketed with, so the list cannot mean something the
   *  chart did not. */
  ageBucket?: string;
  state?: string;
  search?: string;
};

export const dataCenterStock = {
  list: (filters: StockFilters, cursor: StockCursor | null = null, limit = 100) =>
    call<{
      rows: StockRow[];
      hasMore: boolean;
      pageSize: number;
      nextCursor: StockCursor | null;
      scope: string;
    }>("data-center-read", "stock", { filters, cursor, limit }),
};

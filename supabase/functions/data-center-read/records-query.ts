/**
 * The query behind both tables. Keyset paginated, filtered and sorted entirely
 * in Postgres.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. No OFFSET, anywhere, ever. At 500,000 rows an offset of 400,000 makes
 *    Postgres walk and discard 400,000 rows to return 50. There is no `offset`
 *    or `page` parameter in the request shape, so it cannot creep back in
 *    through a caller.
 *
 * 2. Pick the page, then hydrate it. Every read is two statements: one that
 *    finds the page's sale ids against the base tables, and one that fetches
 *    those rows through the view.
 *
 * WHY TWO STATEMENTS RATHER THAN ONE
 *
 * Measured, not assumed. The queue the process cares about most, "called three
 * times and still not verified", selects roughly 6,700 rows out of 500,000. As
 * a single query through the view it took **25.8 seconds**: the planner drove
 * from the sales index hoping to fill the limit early, and walked 480,005 rows
 * evaluating a six-way join for each.
 *
 * Every attempt to persuade it otherwise inside one statement failed. A CTE
 * came back at 1.5s, a materialized CTE at 2.1s, an IN-subquery at 3.3s.
 *
 * Split in two it is 32 ms to pick 51 ids and 8 ms to hydrate them. Forty
 * milliseconds against twenty-six seconds, and it is predictable rather than
 * dependent on what the planner guesses this week.
 *
 * The split has a second benefit worth naming: the filters run against
 * `public.sales` directly, so the trigram search expression matches
 * idx_sales_search_trgm literally instead of relying on the planner inlining a
 * view to see it.
 *
 * NULL sales_date
 *
 * The column is nullable, and the index is (sales_date desc, id desc), which
 * places nulls first under DESC and last under ASC. A plain row comparison
 * against a null cursor yields null and would silently skip those rows, so both
 * directions carry an explicit null branch. In practice the sales form requires
 * a date and the null set is empty, but correctness here should not depend on
 * that staying true.
 */

import { buildScopeSql, type ScopeInput } from "./scope.ts";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface RecordsCursor {
  salesDate: string | null;
  saleId: string;
}

export interface RecordsFilters {
  search?: string;
  organizationId?: string | null;
  userState?: string;
  saleStatus?: string;
  paymentStatus?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;

  // --- Table 2 only. Rejected outright when reading Table 1. ---
  /** fully_verified | partially_verified | doubtful_verification | not_verified */
  verificationOutcome?: string;
  /** none | open | resolved. "open" is the queue waiting on Sales. */
  correctionState?: string;
  /** false selects sales the call centre has never touched. */
  hasCallRecord?: boolean;
  /** The business rule "called three times and still not verified". */
  attemptsAtLeast?: number;
  attemptsAtMost?: number;
}

/**
 * Which of the two tables to read. They are one builder rather than two because
 * they differ only in which columns they select and which filters they accept.
 * Keeping them together is what stops the keyset rules, the page ceiling and
 * the scope predicate from being reimplemented slightly differently for Table 2.
 */
export type TableName = "records" | "call_center";

export interface RecordsRequest {
  table?: TableName;
  cursor?: RecordsCursor | null;
  limit?: number;
  direction?: "desc" | "asc";
  filters?: RecordsFilters;
}

// Named explicitly rather than SELECT *, so a column added to a view cannot
// silently widen what this endpoint returns (block 14).
//
// sales_date is cast to text rather than left as a date. The Postgres driver
// would otherwise hand back a JavaScript Date, and a Date carries a timezone
// that a calendar date does not: formatting it client-side can move a sale a
// day either way, and it also feeds the paging cursor, where a wrong value
// silently skips or repeats rows.
const COLUMNS = [
  "sale_id",
  "transaction_id",
  "sales_date::text as sales_date",
  "stove_serial_no",
  "end_user_name",
  "aka",
  "primary_phone",
  "alternative_phone",
  "buyer_name",
  "buyer_phone",
  "partner_name",
  "retailer_branch",
  "user_state",
  "user_lga",
  "user_residential_address",
  "amount",
  "total_paid",
  "payment_status",
  "is_installment",
  "sale_status",
  "is_archived",
  "platform",
  "created_at",
  "organization_id",
  "partner_state",
  "partner_branch",
  "partner_id",
  "sales_model",
  "sale_agent_name",
  "previous_stove_type",
  "pot_quantity",
  "heat_retention_device",
  "stove_stock_status",
] as const;

/**
 * Table 2 is Table 1 plus what the call centre added.
 *
 * The three call dates here are derived from `call_attempts` by the view, not
 * stored. That is what lets a fourth attempt happen without a migration while
 * the workbook's familiar shape still comes out of an export.
 */
const CALL_CENTER_COLUMNS = [
  ...COLUMNS,
  "verification_outcome",
  "call_outcome",
  "call_agent",
  "call_date_1::text as call_date_1",
  "call_date_2::text as call_date_2",
  "call_date_3::text as call_date_3",
  "attempt_count",
  "last_attempt_at",
  "corrected_phone",
  "corrected_alt_phone",
  "corrected_end_user_name",
  "corrected_address",
  "corrected_state",
  "corrected_lga",
  "ward",
  "landmark",
  "stated_serial",
  "serial_matches",
  "phone_was_corrected",
  "answers",
  "other_comments",
  "correction_state",
  "correction_reason",
  "correction_note",
  "correction_requested_at",
  "correction_resolved_at",
  "has_call_record",
  "call_record_version",
  "call_record_updated_at",
] as const;

const SALE_STATUSES = new Set(["incomplete", "completed", "pending", "assigned"]);
const PAYMENT_STATUSES = new Set(["not_applicable", "partially_paid", "fully_paid"]);
const PLATFORMS = new Set(["web", "mobile"]);
const VERIFICATION_OUTCOMES = new Set([
  "fully_verified",
  "partially_verified",
  "doubtful_verification",
  "not_verified",
]);
const CORRECTION_STATES = new Set(["none", "open", "resolved"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The searchable text, as one expression over `public.sales`.
 *
 * This has to stay equivalent to the expression indexed by migration
 * 20260819050000_data_center_sales_search_index.sql. The planner matches an
 * expression index by comparing parsed expressions, so column order and
 * separators both matter. Because the pick step runs against the base table
 * rather than the view, the two are now written identically, which removes the
 * earlier reliance on view inlining for the match to be seen.
 */
const SEARCH_EXPRESSION = `(
      coalesce(s.end_user_name, '') || ' ' ||
      coalesce(s.contact_person, '') || ' ' ||
      coalesce(s.phone, '') || ' ' ||
      coalesce(s.contact_phone, '') || ' ' ||
      coalesce(s.stove_serial_no, '') || ' ' ||
      coalesce(s.transaction_id, '')
    )`;

export class BadRequest extends Error {}

export interface BuiltQuery {
  /** Step one: find this page's sale ids. Runs against the base tables. */
  pick: { text: string; args: unknown[] };
  /** Step two: fetch those rows through the view. Takes the ids from step one. */
  hydrate: (ids: string[]) => { text: string; args: unknown[] };
  pageSize: number;
  scopeDescription: string;
}

export function buildRecordsQuery(
  request: RecordsRequest,
  scopeInput: ScopeInput,
): BuiltQuery {
  const args: unknown[] = [];
  const p = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };

  const table: TableName = request.table === "call_center" ? "call_center" : "records";
  const direction = request.direction === "asc" ? "asc" : "desc";

  // The ceiling is enforced here rather than trusted from the caller. Asking
  // for 100,000 rows gets 200.
  const pageSize = Math.min(
    Math.max(Number(request.limit) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  const where: string[] = [];

  // --- Scope. Always first, and always present. -----------------------------
  // Applied to the pick step only: step two selects by ids that step one has
  // already filtered, so there is nothing left for it to widen.
  const scope = buildScopeSql(
    { ...scopeInput, requestedOrgId: request.filters?.organizationId ?? null },
    args.length + 1,
    "s",
  );
  where.push(scope.sql);
  args.push(...scope.args);

  const f = request.filters ?? {};

  if (!f.includeArchived) where.push("s.is_archived is not true");

  if (f.search) {
    const term = String(f.search).trim();
    if (term.length > 0) {
      if (term.length > 100) throw new BadRequest("Search term is too long");
      where.push(`${SEARCH_EXPRESSION} ilike ${p(`%${term}%`)}`);
    }
  }

  if (f.userState) where.push(`s.state_backup = ${p(String(f.userState))}`);

  if (f.saleStatus) {
    if (!SALE_STATUSES.has(f.saleStatus)) throw new BadRequest("Unknown sale status");
    where.push(`s.status = ${p(f.saleStatus)}`);
  }
  if (f.paymentStatus) {
    if (!PAYMENT_STATUSES.has(f.paymentStatus)) throw new BadRequest("Unknown payment status");
    where.push(`s.payment_status = ${p(f.paymentStatus)}`);
  }
  if (f.platform) {
    if (!PLATFORMS.has(f.platform)) throw new BadRequest("Unknown platform");
    where.push(`s.platform = ${p(f.platform)}`);
  }
  if (f.dateFrom) {
    if (!ISO_DATE.test(f.dateFrom)) throw new BadRequest("dateFrom must be YYYY-MM-DD");
    where.push(`s.sales_date >= ${p(f.dateFrom)}::date`);
  }
  if (f.dateTo) {
    if (!ISO_DATE.test(f.dateTo)) throw new BadRequest("dateTo must be YYYY-MM-DD");
    where.push(`s.sales_date <= ${p(f.dateTo)}::date`);
  }

  // --- Table 2 filters ------------------------------------------------------
  // Rejected outright on Table 1 rather than ignored, so a caller asking for
  // something that table cannot answer learns that rather than getting a page
  // that quietly ignored half the request.
  const callCentreOnly =
    f.verificationOutcome !== undefined ||
    f.correctionState !== undefined ||
    f.hasCallRecord !== undefined ||
    f.attemptsAtLeast !== undefined ||
    f.attemptsAtMost !== undefined;

  if (table === "records" && callCentreOnly) {
    throw new BadRequest("Call centre filters need the call centre table");
  }

  if (table === "call_center") {
    // A sale with at least one attempt necessarily has a call record, so the
    // "no record yet" branch below is dead whenever attempts are required.
    // Postgres cannot deduce that: left to itself it keeps the `is null` arm,
    // loses the index on call_records and walks sales instead. Measured at
    // 500,000 rows that was 1,225 ms against 40 ms once the arm is dropped.
    const requiresRecord = (f.attemptsAtLeast ?? 0) >= 1 || f.hasCallRecord === true;

    if (f.verificationOutcome) {
      if (!VERIFICATION_OUTCOMES.has(f.verificationOutcome)) {
        throw new BadRequest("Unknown verification outcome");
      }
      // A sale nobody has called has no call record, so it has no outcome
      // either. Treating that as `not_verified` is what makes the default queue
      // ("everything still to verify") one filter rather than a special case
      // every caller has to remember.
      if (f.verificationOutcome === "not_verified" && !requiresRecord) {
        where.push(
          `(cr.verification_outcome is null or cr.verification_outcome = ${p("not_verified")})`,
        );
      } else {
        where.push(`cr.verification_outcome = ${p(f.verificationOutcome)}`);
      }
    }

    if (requiresRecord) where.push("cr.sale_id is not null");

    if (f.correctionState) {
      if (!CORRECTION_STATES.has(f.correctionState)) {
        throw new BadRequest("Unknown correction state");
      }
      // Expressed against the columns rather than the view's derived label, so
      // the partial index on open corrections is usable.
      if (f.correctionState === "open") {
        where.push("cr.correction_requested_at is not null and cr.correction_resolved_at is null");
      } else if (f.correctionState === "resolved") {
        where.push("cr.correction_resolved_at is not null");
      } else {
        where.push("cr.correction_requested_at is null");
      }
    }

    if (f.hasCallRecord !== undefined) {
      where.push(f.hasCallRecord ? "cr.sale_id is not null" : "cr.sale_id is null");
    }

    // "Called three times and still not verified" is the rule that decides who
    // gets chased again and who is written off, so it is a filter rather than
    // something a human counts. It reads call_records.attempt_count, which a
    // trigger maintains precisely so this does not have to count rows.
    if (f.attemptsAtLeast !== undefined) {
      const n = Number(f.attemptsAtLeast);
      if (!Number.isInteger(n) || n < 0) {
        throw new BadRequest("attemptsAtLeast must be a whole number");
      }
      where.push(`coalesce(cr.attempt_count, 0) >= ${p(n)}`);
    }
    if (f.attemptsAtMost !== undefined) {
      const n = Number(f.attemptsAtMost);
      if (!Number.isInteger(n) || n < 0) {
        throw new BadRequest("attemptsAtMost must be a whole number");
      }
      where.push(`coalesce(cr.attempt_count, 0) <= ${p(n)}`);
    }
  }

  // --- The cursor -----------------------------------------------------------
  const cursor = request.cursor;
  if (cursor) {
    if (!UUID.test(String(cursor.saleId))) throw new BadRequest("Malformed cursor");
    if (cursor.salesDate !== null && !ISO_DATE.test(String(cursor.salesDate))) {
      throw new BadRequest("Malformed cursor");
    }
    const id = p(cursor.saleId);

    if (direction === "desc") {
      if (cursor.salesDate === null) {
        // Nulls sort first under DESC, so the rest of the null block comes
        // next, then everything that has a date.
        where.push(`(s.sales_date is not null or (s.sales_date is null and s.id < ${id}::uuid))`);
      } else {
        // The row comparison is what the index serves. It also excludes nulls
        // on its own, which is correct: they were already passed.
        where.push(`(s.sales_date, s.id) < (${p(cursor.salesDate)}::date, ${id}::uuid)`);
      }
    } else {
      if (cursor.salesDate === null) {
        where.push(`(s.sales_date is null and s.id > ${id}::uuid)`);
      } else {
        // Nulls sort last under ASC, so they are still ahead of the cursor.
        where.push(
          `((s.sales_date, s.id) > (${p(cursor.salesDate)}::date, ${id}::uuid) or s.sales_date is null)`,
        );
      }
    }
  }

  // Table 1 needs no join at all unless a call centre filter is in play, and it
  // never is. Table 2 joins the call record so its filters have somewhere to
  // bite; the join is left, because a sale nobody has called is still a row in
  // the queue.
  const join = table === "call_center"
    ? "left join data_center.call_records cr on cr.sale_id = s.id"
    : "";

  const pick = {
    text: `
      select s.id, s.sales_date::text as sales_date
      from public.sales s
      ${join}
      where ${where.join("\n        and ")}
      order by s.sales_date ${direction}, s.id ${direction}
      limit ${pageSize + 1}
    `,
    args,
  };

  const view = table === "call_center"
    ? "data_center.v_call_center"
    : "data_center.v_sold_stoves";
  const selected = table === "call_center" ? CALL_CENTER_COLUMNS : COLUMNS;

  return {
    pick,
    pageSize,
    scopeDescription: scope.description,
    hydrate: (ids: string[]) => ({
      text: `
        select ${selected.map((c) => `v.${c}`).join(", ")}
        from ${view} v
        where v.sale_id = any($1::uuid[])
        order by v.sales_date ${direction}, v.sale_id ${direction}
      `,
      args: [ids],
    }),
  };
}

/**
 * Turns the limit+1 ids from the pick step into a page plus the cursor for the
 * next one. Asking for one more row than the page size is how "is there more"
 * is answered without a count over the full set.
 */
export function toPage(
  picked: { id: string; sales_date: string | null }[],
  pageSize: number,
): { ids: string[]; nextCursor: RecordsCursor | null; hasMore: boolean } {
  const hasMore = picked.length > pageSize;
  const page = hasMore ? picked.slice(0, pageSize) : picked;
  const last = page[page.length - 1];
  return {
    ids: page.map((r) => r.id),
    hasMore,
    nextCursor: hasMore && last
      ? { salesDate: last.sales_date == null ? null : String(last.sales_date), saleId: String(last.id) }
      : null,
  };
}

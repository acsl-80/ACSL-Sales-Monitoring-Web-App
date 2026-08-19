/**
 * Table 1's query. Keyset paginated, filtered and sorted entirely in Postgres.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * No OFFSET, anywhere, ever. At 500,000 rows an offset of 400,000 makes
 * Postgres walk and discard 400,000 rows to return 50. There is no `offset` or
 * `page` parameter in the request shape, so it cannot creep back in later
 * through a caller.
 *
 * Paging instead carries a cursor: the (sales_date, sale_id) of the last row
 * the caller received. The next page is every row strictly after it in the sort
 * order, which is a range scan on idx_sales_sales_date_id and costs the same
 * whether the caller is on page 1 or page 8,000.
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
}

export interface RecordsRequest {
  cursor?: RecordsCursor | null;
  limit?: number;
  direction?: "desc" | "asc";
  filters?: RecordsFilters;
}

// Named explicitly rather than SELECT *, so a column added to the view cannot
// silently widen what this endpoint returns (block 14).
//
// sales_date is cast to text in SQL rather than left as a date. The Postgres
// driver would otherwise hand back a JavaScript Date, and a Date carries a
// timezone that a calendar date does not: formatting it client-side can move a
// sale a day either way, and it also feeds the paging cursor, where a wrong
// value silently skips or repeats rows. Postgres emits ISO YYYY-MM-DD, so
// casting here removes the ambiguity at the source.
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

const SALE_STATUSES = new Set(["incomplete", "completed", "pending", "assigned"]);
const PAYMENT_STATUSES = new Set(["not_applicable", "partially_paid", "fully_paid"]);
const PLATFORMS = new Set(["web", "mobile"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The searchable text, as one expression.
 *
 * This has to stay character-for-character equivalent to the expression indexed
 * by migration 20260819050000_data_center_sales_search_index.sql. The planner
 * matches an expression index by comparing parsed expressions, so the column
 * order and the separators both matter. If they drift apart nothing breaks
 * visibly: search keeps returning correct results, and quietly goes back to a
 * sequential scan. Measured at 500,000 rows that is 1,089 ms instead of 10.9.
 *
 * The view renames four of these columns, so the names here are the view's
 * (buyer_name, primary_phone, buyer_phone) while the index names the underlying
 * ones (contact_person, phone, contact_phone). Postgres inlines the view before
 * matching, so the two resolve to the same expression.
 */
const SEARCH_EXPRESSION = `(
      coalesce(v.end_user_name, '') || ' ' ||
      coalesce(v.buyer_name, '') || ' ' ||
      coalesce(v.primary_phone, '') || ' ' ||
      coalesce(v.buyer_phone, '') || ' ' ||
      coalesce(v.stove_serial_no, '') || ' ' ||
      coalesce(v.transaction_id, '')
    )`;

export class BadRequest extends Error {}

export interface BuiltQuery {
  text: string;
  args: unknown[];
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

  const direction = request.direction === "asc" ? "asc" : "desc";

  // The ceiling is enforced here rather than trusted from the caller. Asking
  // for 100,000 rows gets 200.
  const pageSize = Math.min(
    Math.max(Number(request.limit) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  const where: string[] = [];

  // --- Scope. Always first, and always present. -----------------------------
  const scope = buildScopeSql(
    { ...scopeInput, requestedOrgId: request.filters?.organizationId ?? null },
    args.length + 1,
    "v",
  );
  where.push(scope.sql);
  args.push(...scope.args);

  // --- Filters --------------------------------------------------------------
  const f = request.filters ?? {};

  if (!f.includeArchived) {
    where.push("v.is_archived is not true");
  }

  if (f.search) {
    const term = String(f.search).trim();
    if (term.length > 0) {
      if (term.length > 100) throw new BadRequest("Search term is too long");
      where.push(`${SEARCH_EXPRESSION} ilike ${p(`%${term}%`)}`);
    }
  }

  if (f.userState) where.push(`v.user_state = ${p(String(f.userState))}`);

  if (f.saleStatus) {
    if (!SALE_STATUSES.has(f.saleStatus)) throw new BadRequest("Unknown sale status");
    where.push(`v.sale_status = ${p(f.saleStatus)}`);
  }
  if (f.paymentStatus) {
    if (!PAYMENT_STATUSES.has(f.paymentStatus)) throw new BadRequest("Unknown payment status");
    where.push(`v.payment_status = ${p(f.paymentStatus)}`);
  }
  if (f.platform) {
    if (!PLATFORMS.has(f.platform)) throw new BadRequest("Unknown platform");
    where.push(`v.platform = ${p(f.platform)}`);
  }

  if (f.dateFrom) {
    if (!ISO_DATE.test(f.dateFrom)) throw new BadRequest("dateFrom must be YYYY-MM-DD");
    where.push(`v.sales_date >= ${p(f.dateFrom)}::date`);
  }
  if (f.dateTo) {
    if (!ISO_DATE.test(f.dateTo)) throw new BadRequest("dateTo must be YYYY-MM-DD");
    where.push(`v.sales_date <= ${p(f.dateTo)}::date`);
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
        where.push(
          `(v.sales_date is not null or (v.sales_date is null and v.sale_id < ${id}::uuid))`,
        );
      } else {
        // The row comparison is what the index serves. It also excludes nulls
        // on its own, which is correct: they were already passed.
        where.push(`(v.sales_date, v.sale_id) < (${p(cursor.salesDate)}::date, ${id}::uuid)`);
      }
    } else {
      if (cursor.salesDate === null) {
        where.push(`(v.sales_date is null and v.sale_id > ${id}::uuid)`);
      } else {
        // Nulls sort last under ASC, so they are still ahead of the cursor.
        where.push(
          `((v.sales_date, v.sale_id) > (${p(cursor.salesDate)}::date, ${id}::uuid) or v.sales_date is null)`,
        );
      }
    }
  }

  const text = `
    select ${COLUMNS.map((c) => `v.${c}`).join(", ")}
    from data_center.v_sold_stoves v
    where ${where.join("\n      and ")}
    order by v.sales_date ${direction}, v.sale_id ${direction}
    limit ${pageSize + 1}
  `;

  return { text, args, pageSize, scopeDescription: scope.description };
}

/**
 * Turns the limit+1 rows into a page plus the cursor for the next one. Asking
 * for one more row than the page size is how "is there more" is answered
 * without a count over the full set.
 */
export function toPage<T extends Record<string, unknown>>(
  rows: T[],
  pageSize: number,
): { rows: T[]; nextCursor: RecordsCursor | null; hasMore: boolean } {
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    hasMore,
    // sales_date arrives as an ISO string because the query casts it; see
    // COLUMNS. Anything else would be a bug worth failing loudly on rather than
    // truncating into a cursor that pages past real rows.
    nextCursor: hasMore && last
      ? {
        salesDate: last.sales_date == null ? null : String(last.sales_date),
        saleId: String(last.sale_id),
      }
      : null,
  };
}

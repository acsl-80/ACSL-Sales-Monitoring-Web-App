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
  /** Where the buyer lives, narrower than userState. Only meaningful with it. */
  userLga?: string;
  /** public.payment_models.id - what the view surfaces as sales_model. */
  salesModel?: string;
  /** The profile that recorded the sale, which the view names sale_agent_name. */
  saleAgent?: string;
  /** The partner's own state: the location scorecard's axis, not the buyer's. */
  partnerState?: string;
  /** The rep on the parent TRANSFER, resolved through transaction_id. */
  transferSalesRep?: string;
  saleStatus?: string;
  paymentStatus?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;

  // --- Table 2 only. Rejected outright when reading Table 1. ---
  /** fully_verified | partially_verified | unreachable | not_verified */
  verificationOutcome?: string;
  /** A scorecard column: verified | unverified | unreachable | unresolved. */
  outcomeGroup?: string;
  /** Sales assigned to this call agent, reclaimed batches excluded. */
  assignedAgent?: string;
  /** Sales assigned to any agent reporting to this manager. */
  agentManager?: string;
  /** none | open | resolved. "open" is the queue waiting on Sales. */
  correctionState?: string;
  /** false selects sales the call centre has never touched. */
  hasCallRecord?: boolean;
  /** The business rule "called three times and still not verified". */
  attemptsAtLeast?: number;
  attemptsAtMost?: number;
  /**
   * Records the call centre has finished with: verified to either degree.
   *
   * Deliberately not the same question as the scorecard's "verified" column.
   * That one asks how much of what a partner was sent has been confirmed, and
   * counts only full verification. This one asks whether the call centre still
   * has work to do on a record, and a partially verified record is one it has
   * concluded. Unreachable is not here: nobody has spoken to that buyer yet.
   */
  completed?: boolean;
  /** Records whose stove ID was taken by another caller's rematch. */
  serialUnconfirmed?: boolean;
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
  /*
    Only Table 2 has these. v_sold_stoves carries no corrections at all, so
    naming them in the shared list above asked the sold-stove view for columns
    it has never had - which is a 500, not a compile error, and is what putting
    them there cost.
  */
  "resolved_end_user_name",
  "resolved_phone",
  "resolved_address",
  "was_corrected",
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
  "unreachable",
  "not_verified",
]);

/**
 * The scorecard's four status columns, as filters.
 *
 * Each maps to the same outcomes the metric counted, so a cell saying 12 and
 * the table behind it saying 12 is by construction rather than coincidence.
 * `unresolved` includes sales with no call record at all, exactly as the
 * scorecard's remainder does.
 */
const OUTCOME_GROUPS = new Set(["verified", "unverified", "unreachable", "unresolved"]);
const CORRECTION_STATES = new Set(["none", "open", "fixed", "resolved"]);
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

/**
 * How far a match count will look before it gives up and says "more than this".
 *
 * A plain count(*) cannot stop early: asking how many records match an empty
 * filter at 500,000 rows means counting 500,000 index entries every time
 * somebody opens the page. Wrapping the pick in a LIMIT and counting the
 * result caps the work at ten thousand entries whatever the table holds, and
 * the answer above that ceiling - "10,000+" - is the one a person acts on
 * anyway. Nobody scrolls to row forty thousand; they narrow the filter.
 */
export const COUNT_CEILING = 10_000;

/**
 * The rep who sold the stove, which is not the person who recorded the sale.
 *
 * A digitised receipt is committed through create-sale by whoever ran the
 * import, so `created_by` - and therefore `sale_agent_name` - names the
 * uploader on every imported row. On the 664-row backlog that is one name
 * against 39 partners and 11 actual reps. The person who sold the stove is on
 * the parent transfer, reached by the chain CLAUDE.md names and the
 * transferSalesRep filter below already walks: serial ->
 * stove_ids_base.sales_reference -> stove_transfer_history.transaction_id.
 *
 * Derived here rather than stored on the sale, for two reasons. public.sales
 * has no name-valued attribution column at all - created_by and
 * sold_on_behalf_of are both uuid into profiles, and only 5 of the 11 reps have
 * an account, so the largest of them (262 sales) could not be named by a uuid
 * even if this module were allowed to write one. And deriving it means every
 * row already committed is correct without a backfill that could later drift.
 *
 * Two things about the shape, both measured rather than assumed.
 *
 * A LATERAL with `limit 1`, never a plain join. One stove ID still exists as
 * two stock rows at two different partners, and a plain join would return that
 * sale twice; data-center-import/index.ts:2267-2271 documents the same hazard
 * for the same reason. A page that silently doubles a row is far worse than one
 * missing a column, because every count downstream of it is then wrong.
 *
 * And PLAIN equality on stove_id, not upper(btrim(...)). The normalised form
 * cannot use stove_ids_stove_id_organization_id_key, so it seq-scans the whole
 * stock table once per row: measured on production at 2,907 ms for a 200-row
 * page, against 15 ms for the plain form. Both sides are already stored
 * normalised (0 of 22,032 stock rows and 0 of 701 sales differ from their
 * upper/btrim form) and v_sold_stoves itself joins these two columns plainly.
 */
const REP_LATERAL = `
        left join lateral (
          select h.sales_rep
            from public.stove_ids_base b
            left join public.stove_transfer_history h
                   on h.transaction_id = b.sales_reference
           where b.stove_id = v.stove_serial_no
           limit 1
        ) rep on true`;

export interface BuiltQuery {
  /** Step one: find this page's sale ids. Runs against the base tables. */
  pick: { text: string; args: unknown[] };
  /** Step two: fetch those rows through the view. Takes the ids from step one. */
  hydrate: (ids: string[]) => { text: string; args: unknown[] };
  /**
   * How many records match, up to COUNT_CEILING. Only worth running on the
   * first page of a filter - the answer does not change as you page through.
   */
  count: { text: string; args: unknown[] };
  pageSize: number;
  scopeDescription: string;
}

/**
 * The sheet ceiling.
 *
 * A downloadable sheet is not a page, so 200 is the wrong bound for it - but
 * it still needs one, and it still must not be the caller's to choose. Matches
 * `digitisation_sheet`, whose own limit is 20,000, and matches
 * `import.max_rows`, which is what the importer will accept back.
 */
export const SHEET_PAGE_SIZE = 20_000;

export function buildRecordsQuery(
  request: RecordsRequest,
  scopeInput: ScopeInput,
  /*
   * The ceiling, raised by the SERVER for the one action that builds a file.
   *
   * Deliberately an argument to this function rather than a field on the
   * request: the note below says the ceiling is enforced here rather than
   * trusted from the caller, and a `limit` in the request body would be
   * exactly that trust. This comes from the action, which is code.
   */
  pageSizeCeiling: number = MAX_PAGE_SIZE,
): BuiltQuery {
  const args: unknown[] = [];
  const p = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };

  const table: TableName = request.table === "call_center" ? "call_center" : "records";
  const direction = request.direction === "asc" ? "asc" : "desc";

  // The ceiling is enforced here rather than trusted from the caller. Asking
  // for 100,000 rows gets 200 - or, for the sheet action alone, whatever
  // ceiling that action passed in.
  const pageSize = Math.min(
    Math.max(Number(request.limit) || DEFAULT_PAGE_SIZE, 1),
    pageSizeCeiling,
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

  /*
   * The LGA without the state is deliberately allowed.
   *
   * idx_sales_state_lga_date_id leads with the state, so an LGA on its own
   * cannot use it and walks the date index instead. That is a slower page, not
   * a wrong one, and refusing it would mean somebody who knows the LGA and not
   * which state it is in gets an error instead of an answer. The UI offers LGA
   * only after a state precisely so the fast path is the ordinary one.
   */
  if (f.userLga) where.push(`s.lga_backup = ${p(String(f.userLga))}`);

  // The model is a row in public.payment_models, matched by id rather than by
  // the name the view displays: names are edited, ids are not.
  if (f.salesModel) {
    if (!UUID.test(String(f.salesModel))) throw new BadRequest("salesModel must be a UUID");
    where.push(`s.payment_model_id = ${p(String(f.salesModel))}`);
  }

  // Who recorded the sale. `created_by`, which is what the view resolves into
  // sale_agent_name - not sold_on_behalf_of, which is attribution rather than
  // authorship and would answer a different question under the same label.
  if (f.saleAgent) {
    if (!UUID.test(String(f.saleAgent))) throw new BadRequest("saleAgent must be a UUID");
    where.push(`s.created_by = ${p(String(f.saleAgent))}`);
  }

  // The location scorecard groups by the state ON THE TRANSFER, which is the
  // partner's state. partner_state comes from the same ERP data, so it is the
  // matching axis; user_state is where the buyer lives, a different question.
  // The pick statement reads sales alone, so the partner's state resolves
  // through a subquery rather than an alias the statement does not have.
  if (f.partnerState) {
    where.push(`s.organization_id in (
      select org.id from public.organizations org where org.state = ${p(String(f.partnerState))})`);
  }

  /*
   * The rep on the TRANSFER, not on the sale.
   *
   * This compared `sales.transaction_id` with
   * `stove_transfer_history.transaction_id`, which are two different
   * references that happen to share a column name. A sale's transaction_id is
   * the sale's own reference ("PRV001"); the transfer's is the consignment's
   * ("TR-PRV002"), and it reaches the sale through the stock row, not
   * directly. The two sets never intersect, so this filter matched nothing -
   * and the sales-rep scorecard's drill-through has always opened an empty
   * table without ever saying it had failed to find anything.
   *
   * The chain here is the one CLAUDE.md names and the rest of the module
   * already uses: serial -> stove_ids_base.sales_reference ->
   * stove_transfer_history.transaction_id. Written against stove_ids_base
   * rather than data_center.v_transfer_stoves, which is the same chain but
   * expands every transfer's jsonb array of serials to get there; the stock
   * table already holds one row per stove and idx_stove_ids_sales_reference
   * indexes the join.
   */
  if (f.transferSalesRep) {
    where.push(`s.stove_serial_no in (
      select b.stove_id
        from public.stove_ids_base b
        join public.stove_transfer_history h on h.transaction_id = b.sales_reference
       where h.sales_rep = ${p(String(f.transferSalesRep))})`);
  }

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
    f.outcomeGroup !== undefined ||
    f.assignedAgent !== undefined ||
    f.agentManager !== undefined ||
    f.verificationOutcome !== undefined ||
    f.correctionState !== undefined ||
    f.hasCallRecord !== undefined ||
    f.attemptsAtLeast !== undefined ||
    f.attemptsAtMost !== undefined ||
    f.completed !== undefined ||
    f.serialUnconfirmed !== undefined;

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

    if (f.completed !== undefined) {
      where.push(
        f.completed
          ? `cr.verification_outcome in (${p("fully_verified")}, ${p("partially_verified")})`
          : `(cr.verification_outcome is null
              or cr.verification_outcome not in (${p("fully_verified")}, ${p("partially_verified")}))`,
      );
    }

    if (f.serialUnconfirmed !== undefined) {
      where.push(
        f.serialUnconfirmed
          ? "cr.serial_unconfirmed_at is not null"
          : "cr.serial_unconfirmed_at is null",
      );
    }

    if (f.outcomeGroup) {
      if (!OUTCOME_GROUPS.has(f.outcomeGroup)) throw new BadRequest("Unknown outcome group");
      if (f.outcomeGroup === "verified") {
        where.push(`cr.verification_outcome = ${p("fully_verified")}`);
      } else if (f.outcomeGroup === "unverified") {
        /*
         * Unverified is partially verified alone now that "doubtful" is gone.
         * Kept as one branch rather than folded into the equality above,
         * because the scorecard column it feeds is a group and the next
         * outcome added to that group belongs here rather than in a rewrite.
         */
        where.push(`cr.verification_outcome in (${p("partially_verified")})`);
      } else if (f.outcomeGroup === "unreachable") {
        where.push(`cr.verification_outcome = ${p("unreachable")}`);
      } else {
        // The remainder: no record yet, or a record with nothing concluded.
        where.push(
          `(cr.verification_outcome is null or cr.verification_outcome = ${p("not_verified")})`,
        );
      }
    }

    if (f.assignedAgent) {
      if (!UUID.test(f.assignedAgent)) throw new BadRequest("assignedAgent must be a UUID");
      where.push(`exists (
        select 1 from data_center.assignment_items i
        join data_center.assignment_batches b on b.id = i.batch_id
        where i.sale_id = s.id and b.assigned_to = ${p(f.assignedAgent)}
          and b.state <> 'reclaimed')`);
    }

    if (f.agentManager) {
      if (!UUID.test(f.agentManager)) throw new BadRequest("agentManager must be a UUID");
      where.push(`exists (
        select 1 from data_center.assignment_items i
        join data_center.assignment_batches b on b.id = i.batch_id
        join public.profiles ag on ag.id = b.assigned_to
        where i.sale_id = s.id and ag.manager_id = ${p(f.agentManager)}
          and b.state <> 'reclaimed')`);
    }

    if (requiresRecord) where.push("cr.sale_id is not null");

    if (f.correctionState) {
      if (!CORRECTION_STATES.has(f.correctionState)) {
        throw new BadRequest("Unknown correction state");
      }
      // Expressed against the columns rather than the view's derived label, so
      // the partial index on open corrections is usable.
      if (f.correctionState === "open") {
        // The mirror columns cannot tell open from fixed (both have a request
        // and no resolution), so "Waiting on Sales" asks the episodes.
        where.push(
          "exists (select 1 from data_center.corrections cx where cx.sale_id = cr.sale_id and cx.state = 'open')",
        );
      } else if (f.correctionState === "fixed") {
        // Sales has saved and the call centre has not yet reviewed. The mirror
        // columns still read as open (they stamp resolution only at close), so
        // this one asks the episodes directly.
        where.push(
          "exists (select 1 from data_center.corrections cx where cx.sale_id = cr.sale_id and cx.state = 'fixed')",
        );
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

  /*
   * The count is built here, BEFORE the cursor predicate is appended.
   *
   * "How many records match" and "how many are left below where I am" are
   * different questions, and only the first one belongs beside a filter.
   * Building it after the cursor would make the total shrink as somebody
   * scrolled, which reads as records disappearing.
   *
   * The args array is copied for the same reason: the cursor's parameters are
   * pushed onto it a few lines below, and a shared reference would hand the
   * count two parameters its text never mentions.
   */
  const countArgs = [...args];
  const countWhere = where.join("\n        and ");

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

  /**
   * One view, so one answer to "what is this buyer called".
   *
   * The resolved view applies the call centre's corrections; the plain one
   * leaves them in a column beside the original. Reading the plain one here
   * while the open record and the agent's own queue read the resolved one gave
   * two answers to the same question - the queue listing the name off the
   * receipt while the record showed the name the buyer gave on the phone.
   *
   * That is the split the resolved view was written to end, and it survived
   * because only some consumers were moved.
   */
  const view = table === "call_center"
    ? "data_center.v_call_center_resolved"
    : "data_center.v_sold_stoves";
  const selected = table === "call_center" ? CALL_CENTER_COLUMNS : COLUMNS;

  const count = {
    // The limit is inside the subquery on purpose: Postgres stops picking rows
    // once it has the ceiling, so the cost is bounded by the ceiling and not by
    // how many rows actually match.
    text: `
      select count(*)::int as total
        from (
          select 1
          from public.sales s
          ${join}
          where ${countWhere}
          limit ${COUNT_CEILING}
        ) capped
    `,
    args: countArgs,
  };

  return {
    pick,
    count,
    pageSize,
    scopeDescription: scope.description,
    hydrate: (ids: string[]) => ({
      /*
       * Table 2 also carries serial_unconfirmed_at, the flag the preset
       * "Stove ID unconfirmed" filters on, so the serial can wear the mark in
       * the list (slice 7a). It lives on call_records and not on the resolved
       * view, hence the join here rather than an entry in the column list;
       * the first cut named it as a view column and the queue answered 500.
       */
      text: `
        select ${selected.map((c) => `v.${c}`).join(", ")}, rep.sales_rep${
          table === "call_center" ? ", cr.serial_unconfirmed_at::text as serial_unconfirmed_at" : ""
        }
        from ${view} v${REP_LATERAL}${
          table === "call_center" ? " left join data_center.call_records cr on cr.sale_id = v.sale_id" : ""
        }
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

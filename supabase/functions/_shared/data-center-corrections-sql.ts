/**
 * The correction lifecycle, as SQL, in one place.
 *
 * Two functions reach it: `data-center-corrections` (the list, the workspace,
 * the review) and the `correction` action left on `data-center-write` so the
 * call editor and the existing specs keep working. Both call these, so an
 * episode opens and closes the same way whichever door it came through.
 *
 * Every function expects to run inside a transaction the caller opened with
 * the actor already stamped (`set_config('data_center.actor', ...)`), the way
 * every other module write does. None of them commits.
 */

import type { PoolClient } from "./data-center-db.ts";
import { knownSaleFields } from "./sale-fields.ts";

export class CorrectionError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "bad_input") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Episode = {
  id: string;
  sale_id: string;
  seq: number;
  state: "open" | "fixed" | "resolved";
  reason_id: string | null;
  disputed_fields: string[];
  note: string | null;
  opened_at: string;
  opened_by: string | null;
  routed_rep_user_id: string | null;
  assigned_to: string | null;
  fixed_by: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, what: string): string {
  const s = String(value ?? "");
  if (!UUID_RE.test(s)) throw new CorrectionError(`${what} is required`, 400, "bad_input");
  return s;
}

/** The newest episode for a sale, or null. */
export async function newestEpisode(conn: PoolClient, saleId: string): Promise<Episode | null> {
  const r = await conn.queryObject<Episode>({
    text: `select id::text, sale_id::text, seq, state, reason_id::text, disputed_fields, note,
                  opened_at::text, opened_by::text, routed_rep_user_id::text,
                  assigned_to::text, fixed_by::text
             from data_center.corrections
            where sale_id = $1
            order by seq desc
            limit 1`,
    args: [saleId],
  });
  return r.rows[0] ?? null;
}

/**
 * Which fields a reason points at, from workflow_config. Unknown reason
 * values map to nothing, which is the "other" case: the agent picks.
 */
export async function fieldsForReason(conn: PoolClient, reasonId: string | null): Promise<string[]> {
  if (!reasonId) return [];
  const r = await conn.queryObject<{ fields: string[] | null }>({
    text: `select array(select jsonb_array_elements_text(w.value -> ov.value)) as fields
             from data_center.option_values ov
             cross join data_center.workflow_config w
            where ov.id = $1 and w.key = 'corrections.reason_fields'`,
    args: [reasonId],
  });
  return r.rows[0]?.fields ?? [];
}

/** Where a send-back for this sale goes, as the mapping stands now. */
export async function routeFor(conn: PoolClient, saleId: string) {
  const r = await conn.queryObject<{
    sales_rep: string | null;
    rep_key: string | null;
    rep_user_id: string | null;
    via_delegate: boolean;
    account_name: string | null;
    standing: number;
  }>({
    text: `select f.sales_rep,
                  lower(trim(f.sales_rep)) as rep_key,
                  coalesce(ra.user_id, ra.delegate_user_id)::text as rep_user_id,
                  (ra.user_id is null and ra.delegate_user_id is not null) as via_delegate,
                  rp.full_name as account_name,
                  (select count(*)::int from data_center.send_back_recipients where is_enabled) as standing
             from public.sales s
             left join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
             left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
             left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep))
             left join public.profiles rp on rp.id = coalesce(ra.user_id, ra.delegate_user_id)
            where s.id = $1
            limit 1`,
    args: [saleId],
  });
  return r.rows[0] ?? {
    sales_rep: null, rep_key: null, rep_user_id: null, via_delegate: false, account_name: null, standing: 0,
  };
}

/**
 * Open an episode. Refuses when one is already open or awaiting review: the
 * agent withdraws or the reviewer reopens, so the record never carries two
 * live episodes.
 */
export async function openCorrection(conn: PoolClient, input: {
  saleId: string;
  actorId: string;
  reasonId: string | null;
  fields?: unknown;
  note: string | null;
}): Promise<Episode> {
  const current = await newestEpisode(conn, input.saleId);
  if (current && current.state !== "resolved") {
    throw new CorrectionError(
      current.state === "open"
        ? "This record is already with Sales."
        : "Sales has fixed this record; it is waiting for review.",
      409,
      "already_open",
    );
  }

  let fields: string[];
  if (input.fields === undefined || input.fields === null) {
    fields = await fieldsForReason(conn, input.reasonId);
  } else if (knownSaleFields(input.fields)) {
    fields = [...new Set(input.fields)];
  } else {
    throw new CorrectionError("One of the disputed fields is not a field of a sale.", 400, "bad_field");
  }

  const route = await routeFor(conn, input.saleId);
  const r = await conn.queryObject<Episode>({
    text: `insert into data_center.corrections
             (sale_id, seq, state, reason_id, disputed_fields, note, opened_at, opened_by,
              routed_rep_key, routed_rep_user_id, before, updated_by)
           values ($1,
                   coalesce((select max(seq) from data_center.corrections where sale_id = $1), 0) + 1,
                   'open', $2, $3, $4, now(), $5, $6, $7,
                   data_center.sale_snapshot($1), $5)
           returning id::text, sale_id::text, seq, state, reason_id::text, disputed_fields, note,
                     opened_at::text, opened_by::text, routed_rep_user_id::text,
                     assigned_to::text, fixed_by::text`,
    args: [
      input.saleId,
      input.reasonId,
      fields,
      input.note,
      input.actorId,
      route.rep_key,
      route.rep_user_id,
    ],
  });
  return r.rows[0];
}

/** Take an open episode: it now has somebody's name on it. */
export async function claimCorrection(conn: PoolClient, saleId: string, actorId: string): Promise<Episode> {
  const current = await newestEpisode(conn, saleId);
  if (!current || current.state !== "open") {
    throw new CorrectionError("Nothing is waiting on Sales for this record.", 409, "not_open");
  }
  await conn.queryObject({
    text: `update data_center.corrections
              set assigned_to = $2, claimed_at = coalesce(claimed_at, now()),
                  updated_at = now(), updated_by = $2
            where id = $1`,
    args: [current.id, actorId],
  });
  return { ...current, assigned_to: actorId };
}

/**
 * Sales says it is fixed. The episode moves to `fixed` and waits for the call
 * centre; `after` is the sale as it stands now, so the reviewer sees the diff
 * whether the change came through the workspace or anywhere else.
 */
export async function fixCorrection(conn: PoolClient, input: {
  saleId: string;
  actorId: string;
  note: string | null;
  onBehalf: string | null;
}): Promise<Episode> {
  const current = await newestEpisode(conn, input.saleId);
  if (!current || current.state !== "open") {
    throw new CorrectionError(
      current?.state === "fixed"
        ? "This record is already waiting for review."
        : "Nothing is waiting on Sales for this record.",
      409,
      "not_open",
    );
  }
  await conn.queryObject({
    text: `update data_center.corrections
              set state = 'fixed', fixed_at = now(), fixed_by = $2, fix_note = $3,
                  fixed_on_behalf = $4, assigned_to = coalesce(assigned_to, $2),
                  after = data_center.sale_snapshot(sale_id),
                  updated_at = now(), updated_by = $2
            where id = $1`,
    args: [current.id, input.actorId, input.note, input.onBehalf],
  });
  return { ...current, state: "fixed", fixed_by: input.actorId };
}

/**
 * The call centre's verdict on a fixed episode.
 *
 *   recall     closed; the record goes back into the pool with a fresh
 *              allowance of calls (the view change lands in slice 3).
 *   no_recall  closed; nothing to ring (a confirmed duplicate, a cancelled
 *              sale).
 *   reopen     not fixed after all: this episode closes as `reopened` and the
 *              next one opens with the same reason and fields.
 */
export async function reviewCorrection(conn: PoolClient, input: {
  saleId: string;
  actorId: string;
  outcome: "recall" | "no_recall" | "reopen";
  note: string | null;
}): Promise<Episode> {
  const current = await newestEpisode(conn, input.saleId);
  if (!current || current.state !== "fixed") {
    throw new CorrectionError("This record is not waiting for review.", 409, "not_fixed");
  }
  const outcome = input.outcome === "reopen" ? "reopened" : input.outcome;
  await conn.queryObject({
    text: `update data_center.corrections
              set state = 'resolved', reviewed_at = now(), reviewed_by = $2,
                  review_note = $3, review_outcome = $4,
                  attempts_at_close = (select coalesce(attempt_count, 0)
                                         from data_center.call_records where sale_id = sale_id
                                          and sale_id = data_center.corrections.sale_id),
                  updated_at = now(), updated_by = $2
            where id = $1`,
    args: [current.id, input.actorId, input.note, outcome],
  });

  if (input.outcome === "recall") {
    // The number changed, so "unreachable" no longer describes anything.
    await conn.queryObject({
      text: `update data_center.call_records
                set verification_outcome = 'not_verified',
                    updated_at = now(), updated_by = $2
              where sale_id = $1 and verification_outcome = 'unreachable'`,
      args: [input.saleId, input.actorId],
    });
  }

  if (input.outcome !== "reopen") return { ...current, state: "resolved" };

  const route = await routeFor(conn, input.saleId);
  const next = await conn.queryObject<Episode>({
    text: `insert into data_center.corrections
             (sale_id, seq, state, reason_id, disputed_fields, note, opened_at, opened_by,
              routed_rep_key, routed_rep_user_id, before, reopened_from, updated_by)
           values ($1, $2 + 1, 'open', $3, $4, $5, now(), $6, $7, $8,
                   data_center.sale_snapshot($1), $9, $6)
           returning id::text, sale_id::text, seq, state, reason_id::text, disputed_fields, note,
                     opened_at::text, opened_by::text, routed_rep_user_id::text,
                     assigned_to::text, fixed_by::text`,
    args: [
      input.saleId,
      current.seq,
      current.reason_id,
      current.disputed_fields,
      input.note ?? current.note,
      input.actorId,
      route.rep_key,
      route.rep_user_id,
      current.id,
    ],
  });
  return next.rows[0];
}

/** The call centre takes a send-back back before Sales touched it. */
export async function withdrawCorrection(conn: PoolClient, input: {
  saleId: string;
  actorId: string;
  note: string | null;
}): Promise<Episode> {
  const current = await newestEpisode(conn, input.saleId);
  if (!current || current.state === "resolved") {
    throw new CorrectionError("Nothing is open on this record.", 409, "not_open");
  }
  await conn.queryObject({
    text: `update data_center.corrections
              set state = 'resolved', reviewed_at = now(), reviewed_by = $2,
                  review_note = $3, review_outcome = 'withdrawn',
                  updated_at = now(), updated_by = $2
            where id = $1`,
    args: [current.id, input.actorId, input.note],
  });
  return { ...current, state: "resolved" };
}

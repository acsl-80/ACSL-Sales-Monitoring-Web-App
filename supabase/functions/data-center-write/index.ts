// Data Center: the write endpoint.
//
// Everything an agent records about a sale goes through here. Reads live in
// data-center-read, access administration in data-center-admin; splitting them
// means a token that can read the queue is not automatically one that can
// change it, and the three can be granted separately.
//
// WHAT MAKES THIS MODULAR RATHER THAN JUST FLEXIBLE
//
// The questionnaire is not compiled in. This function reads data_center.field_defs
// on every save and uses it to decide three things:
//
//   which fields exist       an unknown key is rejected, so a stale client
//                            cannot write junk into the answers blob
//   where each one goes      `storage` routes it to answers jsonb or to a real
//                            column, so promoting a question to a column is
//                            invisible to every caller
//   whether it applies       `visible_when` is re-evaluated here, because a
//                            condition enforced only in the UI is a suggestion
//
// So adding a question is an insert into field_defs. No deploy, no client
// change, and the new answer is validated from the moment it exists.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { openConnection, closeConnection, type PoolClient } from "../_shared/data-center-db.ts";
import { featuresFor } from "../_shared/data-center-roles.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  if (!origin) return true;
  const configured = (Deno.env.get("DATA_CENTER_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  return (
    [...DEFAULT_ORIGINS, ...configured].includes(origin) ||
    ORIGIN_SUFFIXES.some((s) => origin.endsWith(s))
  );
}

function resolveCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (originAllowed(origin) && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// The write path holds one connection for a whole request because its actions
// run multi-statement transactions. Opened per request and closed in the
// handler's finally, never pooled: see _shared/data-center-db.ts for what
// pooling inside an edge isolate did to the database.

class BadRequest extends Error {}
class Conflict extends Error {}

// ---------------------------------------------------------------------------
// The registry, read fresh on every save.
//
// Not cached. A supervisor who retires a question expects the next save to
// respect that, and the read is a handful of rows on an indexed table.
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  input_type: string;
  option_list_key: string | null;
  storage: string;
  column_name: string | null;
  is_required: boolean;
  visible_when: { field: string; in: string[] } | null;
  validation: Record<string, unknown> | null;
}

async function loadFields(conn: PoolClient): Promise<FieldDef[]> {
  const result = await conn.queryObject<FieldDef>(
    `select key, input_type, option_list_key, storage, column_name,
            is_required, visible_when, validation
     from data_center.field_defs
     where is_active
     order by section, sort_order`,
  );
  return result.rows;
}

/**
 * Is this question being asked, given what else is on the record?
 *
 * The same rule the form renderer uses. It runs here too because a condition
 * checked only in the browser is decoration: a caller can always post the
 * hidden field anyway.
 */
function isVisible(def: FieldDef, record: Record<string, unknown>): boolean {
  if (!def.visible_when) return true;
  const { field, in: allowed } = def.visible_when;
  if (!field || !Array.isArray(allowed)) return true;
  const current = record[field];
  return allowed.includes(String(current ?? ""));
}

function validateAnswer(def: FieldDef, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  const rules = def.validation ?? {};

  if (def.input_type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new BadRequest(`${def.key} must be a number`);
    if (typeof rules.min === "number" && n < rules.min) {
      throw new BadRequest(`${def.key} must be at least ${rules.min}`);
    }
    if (typeof rules.max === "number" && n > rules.max) {
      throw new BadRequest(`${def.key} must be at most ${rules.max}`);
    }
    return;
  }

  if (def.input_type === "boolean") {
    if (typeof value !== "boolean") throw new BadRequest(`${def.key} must be true or false`);
    return;
  }

  const text = String(value);
  const maxLength = typeof rules.maxLength === "number" ? rules.maxLength : 2000;
  if (text.length > maxLength) {
    throw new BadRequest(`${def.key} is longer than ${maxLength} characters`);
  }
  if (typeof rules.pattern === "string" && !new RegExp(rules.pattern).test(text)) {
    throw new BadRequest(`${def.key} is not in the expected format`);
  }
}

// Columns a caller may set directly. Everything else on call_records is either
// derived, audit, or moved by its own action, so an allowlist is the whole
// defence rather than one of several.
const WRITABLE_COLUMNS = new Set([
  "verification_outcome",
  "call_outcome_id",
  "call_agent_id",
  "corrected_phone",
  "corrected_alt_phone",
  "corrected_end_user_name",
  "corrected_address",
  "corrected_state",
  "corrected_lga",
  "ward",
  "landmark",
  "stated_serial",
  "other_comments",
]);

/**
 * The four the table allows, which was three here for as long as this has
 * existed.
 *
 * `unreachable` was in the check constraint, in the queue's filters, in the
 * funnel view's unreachable_count and in a scorecard column - and could not be
 * set by anybody, because this list refused it and the editor never offered
 * it. So the Unreachable column was permanently zero and read as "we always
 * get through", which is the opposite of what an empty column meant.
 */
const VERIFICATION_OUTCOMES = new Set([
  "fully_verified", "partially_verified", "unreachable", "not_verified",
]);

/**
 * Splits a submitted payload into column updates and answer updates.
 *
 * This is where the promotion path pays off. A question stored in jsonb today
 * and promoted to a column tomorrow arrives from the client under the same key
 * either way; only `storage` in the registry changes, and this function starts
 * routing it somewhere else. No client release, no data migration for the
 * caller to care about.
 */
function splitPayload(
  fields: FieldDef[],
  submitted: Record<string, unknown>,
  merged: Record<string, unknown>,
): { columns: Record<string, unknown>; answers: Record<string, unknown> } {
  const columns: Record<string, unknown> = {};
  const answers: Record<string, unknown> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const [key, value] of Object.entries(submitted)) {
    if (WRITABLE_COLUMNS.has(key)) {
      columns[key] = value === "" ? null : value;
      continue;
    }

    const def = byKey.get(key);
    if (!def) {
      // Unknown keys are refused rather than dropped. A client sending one is
      // out of step with the registry, and silently discarding the answer would
      // look to the agent like it saved.
      throw new BadRequest(`Unknown field: ${key}`);
    }
    if (!isVisible(def, merged)) {
      throw new BadRequest(`${key} does not apply to this record`);
    }
    validateAnswer(def, value);

    if (def.storage === "column" && def.column_name) {
      columns[def.column_name] = value === "" ? null : value;
    } else {
      answers[key] = value === "" ? null : value;
    }
  }

  return { columns, answers };
}

serve(async (req) => {
  const cors = resolveCors(req);

  const requestOrigin = req.headers.get("Origin") ?? "";
  if (!originAllowed(requestOrigin)) {
    return json({ error: "Origin not permitted", code: "bad_origin" }, 403, cors);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405, cors);
  }

  let conn: PoolClient | null = null;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization header", code: "no_token" }, 401, cors);
    }
    const token = authHeader.slice("Bearer ".length);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user) {
      return json({ error: "Unauthorized", code: "invalid_token" }, 401, cors);
    }
    const userId = auth.user.id;

    const { data: profile } = await supabase
      .from("profiles").select("role, organization_id").eq("id", userId).single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }
    const superAdmin = profile.role === "super_admin";

    let body: { action?: string; [key: string]: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    conn = await openConnection();

    // Entry, then the feature. Both here, both from the token, every time.
    let features: string[] = [];
    if (!superAdmin) {
      const access = await conn.queryObject<{ access_role: string }>({
        text: "select access_role from data_center.module_access where user_id = $1",
        args: [userId],
      });
      const accessRole = access.rows[0]?.access_role ?? null;
      if (!accessRole) {
        return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
      }
      const grants = await conn.queryObject<{ feature_key: string }>({
        text: "select feature_key from data_center.feature_grants where user_id = $1",
        args: [userId],
      });
      features = featuresFor(accessRole, grants.rows.map((g) => g.feature_key));

      /**
       * Two of the five actions are reads, and all five were gated on
       * `call_records.edit`. So a viewer could reach the call centre table and
       * not open a single record on it, which reads as the module being broken
       * rather than as a permission working.
       *
       * `form_schema` returns the registry, which is the questions themselves.
       * `call_record` returns one record with its history. Neither writes.
       */
      const READ_ONLY_ACTIONS = new Set(["form_schema", "call_record"]);
      const needed = READ_ONLY_ACTIONS.has(String(body.action))
        ? "call_records.view"
        : "call_records.edit";

      if (!features.includes(needed)) {
        return json(
          {
            error: needed === "call_records.view"
              ? "Not permitted to read call records"
              : "Not permitted to change call records",
            code: "no_feature",
          },
          403,
          cors,
        );
      }
    }

    /**
     * Every write runs in one transaction with the actor stamped on the
     * connection. The audit trigger reads that setting, so a change cannot be
     * recorded without knowing who made it, and application code cannot skip
     * the log because it does not write it.
     */
    const begin = async () => {
      await conn!.queryObject("begin");
      await conn!.queryObject({
        text: "select set_config('data_center.actor', $1, true)",
        args: [userId],
      });
    };

    switch (body.action) {
      /**
       * The form's definition: what to render, in what order, with what
       * choices. Served from the registry, so the client never contains a copy
       * of the questionnaire.
       */
      case "form_schema": {
        const fields = await conn.queryObject(
          `select key, label, section, input_type, option_list_key, storage,
                  sort_order, is_required, help_text, visible_when, validation
           from data_center.field_defs
           where is_active
           order by section, sort_order`,
        );
        const options = await conn.queryObject(
          `select ov.list_key, ov.id, ov.value, ov.label, ov.sort_order
           from data_center.option_values ov
           where ov.is_active
           order by ov.list_key, ov.sort_order`,
        );
        const grouped: Record<string, unknown[]> = {};
        for (const row of options.rows as Record<string, unknown>[]) {
          const key = String(row.list_key);
          (grouped[key] ??= []).push(row);
        }
        return json({ data: { fields: fields.rows, options: grouped } }, 200, cors);
      }

      /** One record, with its attempts, for the editor. */
      case "call_record": {
        const saleId = String(body.saleId ?? "");

        /*
         * The draft comes back with the record, not after it.
         *
         * A second round trip would mean the form renders empty, then fills
         * in - and an agent who starts typing in that gap has their first
         * keystrokes overwritten by their own draft arriving late.
         */
        const draft = await conn.queryObject({
          text: `select d.values, d.base_version, d.saved_at,
                        p.full_name as saved_by_name,
                        (d.saved_by = $2) as saved_by_me
                   from data_center.call_drafts d
                   left join public.profiles p on p.id = d.saved_by
                  where d.sale_id = $1`,
          args: [saleId, userId],
        });
        // Named columns, not SELECT *, so a column added to the view cannot
        // silently widen what this returns. Dates are cast to text for the same
        // reason the queue casts them: the driver would hand back a JavaScript
        // Date, whose timezone can move a calendar date by a day.
        const record = await conn.queryObject({
          text: `select
                   sale_id, transaction_id, sales_date::text as sales_date,
                   stove_serial_no, end_user_name, aka,
                   primary_phone, alternative_phone, buyer_name, buyer_phone,
                   partner_name, retailer_branch, user_state, user_lga,
                   user_residential_address, amount, sale_status, sales_model,
                   verification_outcome, call_outcome, call_agent,
                   call_date_1::text as call_date_1,
                   call_date_2::text as call_date_2,
                   call_date_3::text as call_date_3,
                   attempt_count, last_attempt_at,
                   corrected_phone, corrected_alt_phone, corrected_end_user_name,
                   corrected_address, corrected_state, corrected_lga,
                   ward, landmark, stated_serial, serial_matches, phone_was_corrected,
                   answers, other_comments,
                   correction_state, correction_reason, correction_note,
                   correction_requested_at, correction_resolved_at,
                   has_call_record, call_record_version, call_record_updated_at,

                   /*
                    * Everything else an agent needs to follow up.
                    *
                    * The card used to carry four fields - phone, buyer,
                    * address, sold - which is enough to dial and not enough to
                    * hold a conversation. An agent who cannot say which stove,
                    * from which partner, bought on what terms, with how many
                    * pots, is reading from a stub while the buyer is talking.
                    */
                   resolved_end_user_name, resolved_phone, resolved_alt_phone,
                   resolved_address, resolved_state, resolved_lga, was_corrected,
                   sale_agent_name, partner_state, partner_branch, partner_id,
                   previous_stove_type, previous_stove_other,
                   pot_quantity, heat_retention_device,
                   total_paid, payment_status, is_installment, platform,
                   factory, stove_stock_status, latitude, longitude,
                   created_at::text as recorded_at
                 from data_center.v_call_center_resolved where sale_id = $1`,
          args: [saleId],
        });
        if (record.rows.length === 0) {
          return json({ error: "No such sale", code: "not_found" }, 404, cors);
        }

        /**
         * Two things the view does not carry, both of which change what the
         * agent should do before anything else on the screen.
         *
         * A record whose stove ID was taken by another caller's rematch cannot
         * be verified until somebody rings this buyer, and a number carrying
         * other stoves means the person answering may be talking about one of
         * them. Neither belongs at the bottom of a form.
         */
        const flags = await conn.queryObject({
          text: `select cr.serial_unconfirmed_at, cr.serial_unconfirmed_reason
                   from data_center.call_records cr
                  where cr.sale_id = $1`,
          args: [saleId],
        });
        const extra = (flags.rows[0] ?? {}) as Record<string, unknown>;
        // The shared-phone list stands alone: a sale with no call record yet
        // still has a number, and the register still knows what is on it.
        const shares = await conn.queryObject({
          text: `select json_agg(json_build_object(
                          'stove_id', o.stove_id,
                          'buyer', s2.end_user_name,
                          'sale_id', o.sale_id::text) order by o.created_at) as list
                   from data_center.shared_phones o
                   left join public.sales s2 on s2.id = o.sale_id
                  where o.sale_id <> $1
                    and o.phone_tail = (
                          select right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10)
                            from public.sales s where s.id = $1)`,
          args: [saleId],
        });
        Object.assign(record.rows[0] as Record<string, unknown>, {
          serial_unconfirmed_at: extra.serial_unconfirmed_at ?? null,
          serial_unconfirmed_reason: extra.serial_unconfirmed_reason ?? null,
          shares_phone_with: (shares.rows[0] as { list: unknown } | undefined)?.list ?? [],
        });
        const attempts = await conn.queryObject({
          text: `select a.id::text, a.attempt_no, a.attempted_at, a.note,
                        o.label as outcome, g.label as agent, b.label as answered_by
                 from data_center.call_attempts a
                 left join data_center.option_values o on o.id = a.outcome_id
                 left join data_center.option_values g on g.id = a.agent_id
                 left join data_center.option_values b on b.id = a.answered_by_id
                 where a.sale_id = $1 order by a.attempt_no`,
          args: [saleId],
        });
        return json(
          {
            data: {
              record: record.rows[0],
              attempts: attempts.rows,
              // Null when nothing was left half-finished, which is the
              // ordinary case. The editor merges it over the record and says
              // whose it is rather than applying it silently.
              draft: draft.rows[0] ?? null,
            },
          },
          200,
          cors,
        );
      }

      /**
       * Create or update the call record.
       *
       * Upsert rather than separate create and update actions: an agent opening
       * a sale nobody has called does not think of it as creating anything, and
       * two code paths would be two places for the version check to go wrong.
       */
      case "save_call_record": {
        const saleId = String(body.saleId ?? "");
        if (!saleId) throw new BadRequest("saleId is required");
        const submitted = (body.values ?? {}) as Record<string, unknown>;
        const expectedVersion = body.version === undefined ? null : Number(body.version);

        if (
          submitted.verification_outcome !== undefined &&
          !VERIFICATION_OUTCOMES.has(String(submitted.verification_outcome))
        ) {
          throw new BadRequest("Unknown verification outcome");
        }

        await begin();
        try {
          const existing = await conn.queryObject<{ version: number; answers: Record<string, unknown>; verification_outcome: string }>({
            text: `select version, answers, verification_outcome
                   from data_center.call_records where sale_id = $1 for update`,
            args: [saleId],
          });
          const current = existing.rows[0] ?? null;

          if (current && expectedVersion !== null && current.version !== expectedVersion) {
            throw new Conflict(
              "Someone else changed this record while you had it open. Reload to see their changes.",
            );
          }

          // Conditions are evaluated against the record as it will be after
          // this save, not as it was. Otherwise setting the outcome and
          // answering the question it reveals could not happen in one save.
          const merged = {
            ...(current ?? {}),
            ...submitted,
          } as Record<string, unknown>;

          const fields = await loadFields(conn!);
          const { columns, answers } = splitPayload(fields, submitted, merged);

          if (!current) {
            await conn!.queryObject({
              text: `insert into data_center.call_records (sale_id, created_by) values ($1, $2)`,
              args: [saleId, userId],
            });
          }

          const sets: string[] = [];
          const args: unknown[] = [saleId];
          for (const [col, value] of Object.entries(columns)) {
            args.push(value);
            sets.push(`${col} = $${args.length}`);
          }
          if (Object.keys(answers).length > 0) {
            args.push(JSON.stringify(answers));
            // Merge rather than replace: a form showing a subset of questions
            // must not erase the answers it did not render.
            sets.push(`answers = coalesce(answers, '{}'::jsonb) || $${args.length}::jsonb`);
          }
          args.push(userId);
          sets.push(`updated_by = $${args.length}`);
          sets.push("updated_at = now()");
          sets.push("version = version + 1");

          const updated = await conn!.queryObject<{ version: number }>({
            text: `update data_center.call_records set ${sets.join(", ")}
                   where sale_id = $1 returning version`,
            args,
          });

          /*
           * The draft is finished with, and goes in the same transaction.
           *
           * Cleared here rather than by the client after a successful save,
           * because a client that saves and then loses its connection would
           * leave a draft describing a record that has already moved past it -
           * and the agent would reopen it to be told their own saved work is
           * an unfinished draft over a newer record.
           */
          await conn!.queryObject({
            text: `delete from data_center.call_drafts where sale_id = $1`,
            args: [saleId],
          });

          await conn!.queryObject("commit");
          return json({ data: { saleId, version: updated.rows[0]?.version } }, 200, cors);
        } catch (err) {
          await conn!.queryObject("rollback");
          throw err;
        }
      }

      /**
       * Keep a half-finished call form.
       *
       * The case this exists for: the line drops after four answers out of
       * eleven, or the buyer says ring me back this evening. Every one of
       * those used to end with the form closing and the work going with it, so
       * the same buyer was asked the same four questions twice.
       *
       * NOTHING IS VALIDATED HERE, ON PURPOSE
       *
       * A half-finished form fails validation by definition - that is what
       * half-finished means. Refusing to store it for rules the agent has not
       * reached yet would teach people that saving does not work, which is the
       * one outcome worse than losing the work. `save_call_record` validates,
       * and it is still the only door to the record itself.
       *
       * The size cap is the only rule. It is not about correctness, it is
       * about a client bug turning autosave into an append loop.
       */
      case "save_call_draft": {
        const saleId = String(body.saleId ?? "");
        if (!saleId) throw new BadRequest("saleId is required");

        const values = (body.values ?? {}) as Record<string, unknown>;
        const encoded = JSON.stringify(values);
        // 256 KB. A form of eleven questions is a couple of kilobytes; anything
        // near this ceiling is a loop, not an agent typing.
        if (encoded.length > 256_000) {
          throw new BadRequest("That draft is too large to keep. Save the record instead.");
        }

        const baseVersion = body.baseVersion === undefined || body.baseVersion === null
          ? null
          : Number(body.baseVersion);

        /*
         * An empty draft is a deletion, not an empty row.
         *
         * The editor autosaves on change, and "cleared the last field" arrives
         * here as {}. Storing that would put the record on the agent's
         * unfinished list for ever with nothing in it to finish.
         */
        if (Object.keys(values).length === 0) {
          const gone = await conn.queryObject({
            text: `delete from data_center.call_drafts where sale_id = $1`,
            args: [saleId],
          });
          return json(
            { data: { saleId, kept: false, cleared: Number(gone.rowCount ?? 0) > 0 } },
            200,
            cors,
          );
        }

        const saved = await conn.queryObject<{ saved_at: string }>({
          /*
           * Replace rather than merge. The editor sends the whole form every
           * time, so a merge would make a field the agent deliberately cleared
           * come back from the previous draft - the one edit a draft must not
           * undo.
           */
          text: `insert into data_center.call_drafts
                        (sale_id, values, base_version, saved_at, saved_by)
                 values ($1, $2::jsonb, $3, now(), $4)
                 on conflict (sale_id) do update
                    set values = excluded.values,
                        base_version = excluded.base_version,
                        saved_at = now(),
                        saved_by = excluded.saved_by
                 returning saved_at`,
          args: [saleId, encoded, baseVersion, userId],
        });

        return json(
          { data: { saleId, kept: true, savedAt: saved.rows[0]?.saved_at } },
          200,
          cors,
        );
      }

      /**
       * Throw a draft away.
       *
       * Its own action rather than an empty save, because the two are
       * different intentions and the audit trail should be able to tell them
       * apart: one is an agent clearing the last field, the other is an agent
       * deciding the half-finished answers are wrong and starting again.
       */
      case "discard_call_draft": {
        const saleId = String(body.saleId ?? "");
        if (!saleId) throw new BadRequest("saleId is required");
        const gone = await conn.queryObject({
          text: `delete from data_center.call_drafts where sale_id = $1`,
          args: [saleId],
        });
        return json(
          { data: { saleId, discarded: Number(gone.rowCount ?? 0) > 0 } },
          200,
          cors,
        );
      }

      /**
       * Log a call. The attempt number is assigned here, from the rows that
       * exist, so two agents logging at the same moment cannot both claim the
       * same one: the row lock taken above serialises them.
       */
      case "log_attempt": {
        const saleId = String(body.saleId ?? "");
        if (!saleId) throw new BadRequest("saleId is required");

        await begin();
        try {
          await conn.queryObject({
            text: `insert into data_center.call_records (sale_id, created_by)
                   values ($1, $2) on conflict (sale_id) do nothing`,
            args: [saleId, userId],
          });
          // Lock the parent so the max() below cannot be read by two writers at
          // once. Without it the unique constraint would reject the loser with
          // a constraint error rather than giving them the next number.
          await conn.queryObject({
            text: "select 1 from data_center.call_records where sale_id = $1 for update",
            args: [saleId],
          });

          const inserted = await conn.queryObject<{ attempt_no: number }>({
            text: `insert into data_center.call_attempts
                     (sale_id, attempt_no, attempted_at, outcome_id, agent_id, answered_by_id, note, created_by)
                   select $1,
                          coalesce(max(attempt_no), 0) + 1,
                          coalesce($2::timestamptz, now()),
                          $3, $4, $5, $6, $7
                   from data_center.call_attempts where sale_id = $1
                   returning attempt_no`,
            args: [
              saleId,
              body.attemptedAt ?? null,
              body.outcomeId ?? null,
              body.agentId ?? null,
              body.answeredById ?? null,
              body.note ?? null,
              userId,
            ],
          });

          // The record's headline outcome tracks the latest attempt, so the
          // queue does not need a join to answer "what happened last time".
          if (body.outcomeId) {
            await conn.queryObject({
              text: `update data_center.call_records
                     set call_outcome_id = $2, updated_by = $3, updated_at = now(), version = version + 1
                     where sale_id = $1`,
              args: [saleId, body.outcomeId, userId],
            });
          }

          await conn.queryObject("commit");
          return json({ data: { attemptNo: inserted.rows[0]?.attempt_no } }, 200, cors);
        } catch (err) {
          await conn.queryObject("rollback");
          throw err;
        }
      }

      /** Send a record back to Sales, or mark it fixed. */
      case "correction": {
        const saleId = String(body.saleId ?? "");
        const open = body.open !== false;
        if (!saleId) throw new BadRequest("saleId is required");

        await begin();
        try {
          await conn.queryObject({
            text: `insert into data_center.call_records (sale_id, created_by)
                   values ($1, $2) on conflict (sale_id) do nothing`,
            args: [saleId, userId],
          });
          await conn.queryObject({
            text: open
              ? `update data_center.call_records
                   set correction_requested_at = now(), correction_requested_by = $2,
                       correction_reason_id = $3, correction_note = $4,
                       correction_resolved_at = null, correction_resolved_by = null,
                       updated_by = $2, updated_at = now(), version = version + 1
                 where sale_id = $1`
              : `update data_center.call_records
                   set correction_resolved_at = now(), correction_resolved_by = $2,
                       updated_by = $2, updated_at = now(), version = version + 1
                 where sale_id = $1`,
            args: open
              ? [saleId, userId, body.reasonId ?? null, body.note ?? null]
              : [saleId, userId],
          });
          await conn.queryObject("commit");
          return json({ data: { saleId, correctionOpen: open } }, 200, cors);
        } catch (err) {
          await conn.queryObject("rollback");
          throw err;
        }
      }

      /**
       * The buyer reads the number off the label and it does not match.
       *
       * This is the one correction only the agent on the call can make, and
       * until now the only thing they could do with it was send the sale back
       * to Sales, where nobody has the buyer on the phone. Three cases, and
       * only the third is interesting:
       *
       *   a. The confirmed ID is not in the stove register at all. Nothing to
       *      rematch - a misread, or a stove that never came through us.
       *   b. It is in the register and unsold. Move the sale onto it and
       *      release the old one back to available.
       *   c. It is already sold to somebody else. Two stoves were swapped in
       *      the field, most likely on the day they were handed out. The
       *      caller confirming takes precedence, so the two sales exchange
       *      stoves - and the OTHER buyer's record is flagged, because nobody
       *      has confirmed anything with them and an agent has to ring them.
       *
       * WHY THIS WRITES TO public.sales
       *
       * The module's rule is that it never CREATES a sale outside create-sale,
       * so stock linking, status and scoping stay in one place. This is not a
       * creation: it moves one column on an existing sale and the two stock
       * rows that must move with it. create-sale cannot do it - update-sale
       * does not touch the serial either - and doing it in two steps from the
       * client would leave a window where a stove belongs to nobody or to two
       * people. So it happens here, in one transaction, under a lock, with the
       * stock bookkeeping in the same statement list as the sale.
       *
       * WHY THE LOCK
       *
       * Read the stove, decide, then write is exactly the check-then-act shape
       * that assignment and the metrics run were both raced in testing. Two
       * agents confirming the same stove at the same moment is rarer and no
       * less wrong.
       */
      case "serial_rematch": {
        const saleId = String(body.saleId ?? "");
        const confirmed = String(body.confirmedSerial ?? "").trim().slice(0, 120);
        const note = body.note == null ? null : String(body.note).slice(0, 500);
        if (!saleId) throw new BadRequest("saleId is required");
        if (!confirmed) throw new BadRequest("confirmedSerial is required");

        await begin();
        try {
          // 8150621 is the assignment engine's lock; a different number, so a
          // rematch and an assignment run do not block each other for no
          // reason. They touch different rows.
          const got = await conn.queryObject<{ locked: boolean }>(
            "select pg_try_advisory_xact_lock(8150622) as locked",
          );
          if (!got.rows[0]?.locked) {
            await conn.queryObject("rollback");
            return json(
              {
                error: "Another stove ID is being rematched right now. Try again in a moment.",
                code: "busy",
              },
              409,
              cors,
            );
          }

          /**
           * The partner of the STOVE, not of the sale.
           *
           * "Within partner" means the two stoves came out of the same
           * partner's consignment - which is the only way two of them get
           * swapped, at the moment they are handed out. A sale's own
           * organization_id is a different fact and the two legitimately
           * disagree: a sale written under one org against stock transferred
           * to another is ordinary, and comparing those would refuse valid
           * swaps while allowing stoves to cross partners.
           */
          const mine = await conn.queryObject<
            { stove_serial_no: string | null; stock_org: string | null; end_user_name: string | null }
          >({
            text: `select s.stove_serial_no, b.organization_id::text as stock_org, s.end_user_name
                     from public.sales s
                     left join public.stove_ids_base b
                            on upper(b.stove_id) = upper(s.stove_serial_no)
                    where s.id = $1 and s.is_archived is not true`,
            args: [saleId],
          });
          if (mine.rows.length === 0) throw new BadRequest("No such sale");
          const current = mine.rows[0].stove_serial_no ?? "";
          const org = mine.rows[0].stock_org;

          if (current.toUpperCase() === confirmed.toUpperCase()) {
            await conn.queryObject("rollback");
            return json(
              {
                error: `This record already carries ${current}. Nothing to change.`,
                code: "no_change",
              },
              400,
              cors,
            );
          }

          // Case (a): not ours at all.
          const target = await conn.queryObject<
            { stove_id: string; status: string; sale_id: string | null; organization_id: string | null }
          >({
            text: `select stove_id, status, sale_id::text, organization_id::text
                     from public.stove_ids_base
                    where upper(stove_id) = upper($1) limit 1`,
            args: [confirmed],
          });
          if (target.rows.length === 0) {
            await conn.queryObject("rollback");
            return json(
              {
                error:
                  `"${confirmed}" is not in the stove register. Read the number back to the buyer ` +
                  `a digit at a time - an O for a zero and a 1 for a 7 are the usual two - and if it ` +
                  `still does not match, send the sale back to Sales with the number they gave you.`,
                code: "unknown_serial",
              },
              404,
              cors,
            );
          }
          const stove = target.rows[0];

          // The answer to the cross-partner question: within a partner only.
          // A stove crossing partners changes two sets of reconciliation
          // numbers, and is far likelier to be a data problem than two
          // customers swapping stoves across partner lines.
          if (org && stove.organization_id && stove.organization_id !== org) {
            // Named for what it is: both stoves' partners, not the sale's.
            await conn.queryObject("rollback");
            return json(
              {
                error:
                  `"${confirmed}" belongs to a different partner, so it cannot be swapped here. ` +
                  `A stove crossing partners changes both partners' figures and needs somebody to ` +
                  `look at it. Log the number the buyer gave you and send the sale back to Sales.`,
                code: "cross_partner",
              },
              409,
              cors,
            );
          }

          const otherSaleId = stove.sale_id;
          const kind = otherSaleId ? "swapped" : "claimed_available";

          /**
           * Every stock write is a claim, not an announcement.
           *
           * The rematch reads a stove, decides, and then writes - and between
           * the read and the write, create-sale can claim that same stove for
           * a bulk import or a sale on the phone. This function's advisory lock
           * does not exclude those: they take no advisory lock at all, because
           * they are protected by exactly this pattern instead.
           *
           * So each write carries the state it expects to overwrite. If the
           * row no longer looks the way it looked a moment ago, zero rows match
           * and this throws - which rolls back the whole transaction, including
           * the sale rows already moved above. Without it the update matched
           * anyway and overwrote a claim somebody else had just won, leaving
           * one stove with two sales. Proved against the preview: the
           * unguarded statement matches 1 row where the guarded one matches 0.
           *
           * This is the same fix, in the same shape, that create-sale carries
           * for the same reason.
           */
          const claim = async (
            stoveId: string,
            expected: string | null,
            next: string | null,
            what: string,
          ) => {
            const done = await conn.queryObject({
              text: `update public.stove_ids_base
                        set sale_id = $3::uuid,
                            status = case when $3::uuid is null then 'available' else 'sold' end
                      where upper(stove_id) = upper($1)
                        and sale_id is not distinct from $2::uuid`,
              args: [stoveId, expected, next],
            });
            if (Number(done.rowCount ?? 0) === 0) {
              throw new Conflict(
                `${stoveId} changed hands while this was being saved, so nothing was ` +
                  `moved. ${what} Open the record again and read the number back to the ` +
                  `buyer before trying once more.`,
              );
            }
          };

          // The sale takes the confirmed stove.
          await conn.queryObject({
            text: `update public.sales set stove_serial_no = $2, updated_at = now(), updated_by = $3
                    where id = $1`,
            args: [saleId, stove.stove_id, userId],
          });

          if (otherSaleId) {
            // Case (c): they exchange. The other sale takes what this one had,
            // which keeps both stoves owned and neither owned twice.
            await conn.queryObject({
              text: `update public.sales set stove_serial_no = $2, updated_at = now(), updated_by = $3
                      where id = $1`,
              args: [otherSaleId, current, userId],
            });
            // We held `current` a moment ago; hand it over only if we still do.
            await claim(
              current,
              saleId,
              otherSaleId,
              "Somebody else took the stove this record was on.",
            );

            /**
             * The displaced buyer is flagged, not quietly moved.
             *
             * Nobody has confirmed anything with them. Their record now names
             * a stove they have never read out, on the word of a different
             * customer, and an agent has to ring them before it can be
             * verified. Silently rewriting it would turn one uncertain record
             * into two records that both look settled.
             */
            await conn.queryObject({
              text: `insert into data_center.call_records (sale_id, created_by)
                     values ($1, $2) on conflict (sale_id) do nothing`,
              args: [otherSaleId, userId],
            });
            await conn.queryObject({
              text: `update data_center.call_records
                        set serial_unconfirmed_at = now(),
                            serial_unconfirmed_reason = $2,
                            updated_by = $3, updated_at = now(), version = version + 1
                      where sale_id = $1`,
              args: [
                otherSaleId,
                `Another buyer confirmed ${stove.stove_id} on a call, so this record now carries ` +
                  `${current} instead. Ring this buyer and confirm which stove they actually have.`,
                userId,
              ],
            });
          } else {
            // Case (b): the old stove goes back on the shelf - but only if it
            // is still ours to put there.
            await claim(
              current,
              saleId,
              null,
              "Somebody else took the stove this record was on.",
            );
          }

          /*
            The one that matters most: take the confirmed stove only if it is
            still exactly as it was read - free in the claim case, held by the
            other sale in the swap case. `is not distinct from` rather than `=`
            because in the claim case the expected value is NULL, and NULL = NULL
            is not true.
          */
          await claim(
            stove.stove_id,
            otherSaleId,
            saleId,
            `${stove.stove_id} was sold to somebody else while this was being saved.`,
          );

          // This record is settled: it carries the number its buyer read out.
          await conn.queryObject({
            text: `insert into data_center.call_records (sale_id, stated_serial, created_by)
                   values ($1, $2, $3)
                   on conflict (sale_id) do update
                      set stated_serial = excluded.stated_serial,
                          serial_unconfirmed_at = null,
                          serial_unconfirmed_reason = null,
                          updated_by = excluded.created_by, updated_at = now(),
                          version = data_center.call_records.version + 1`,
            args: [saleId, stove.stove_id, userId],
          });

          await conn.queryObject({
            text: `insert into data_center.serial_rematches
                     (sale_id, from_serial, to_serial, swapped_with_sale_id, kind, note, created_by)
                   values ($1, $2, $3, $4, $5, $6, $7)`,
            args: [saleId, current, stove.stove_id, otherSaleId, kind, note, userId],
          });

          await conn.queryObject("commit");
          return json(
            {
              data: {
                saleId,
                fromSerial: current,
                toSerial: stove.stove_id,
                kind,
                swappedWithSaleId: otherSaleId,
              },
            },
            200,
            cors,
          );
        } catch (err) {
          await conn.queryObject("rollback");
          throw err;
        }
      }

      /**
       * A number the call confirms is already carrying another stove.
       *
       * On this path the rule still applies - one number, one stove - and what
       * the agent gets is a flag rather than a refusal, naming what is already
       * on it. Recording it here is what puts it on the register, so the next
       * person to open either record sees the other.
       */
      case "record_shared_phone": {
        const saleId = String(body.saleId ?? "");
        const phone = String(body.phone ?? "").trim();
        const note = body.note == null ? null : String(body.note).slice(0, 500);
        if (!saleId) throw new BadRequest("saleId is required");
        const tail = phone.replace(/\D+/g, "").slice(-10);
        if (tail.length !== 10) {
          throw new BadRequest("That number is too short to match on");
        }

        await begin();
        try {
          /**
           * Every sale on the number, this one included, in one insert - so
           * the register never holds one half of a sharing. Which is what a
           * row written for only the new side would be: invisible from the
           * record that was there first.
           */
          const written = await conn.queryObject<{ sale_id: string; stove_serial_no: string }>({
            text: `insert into data_center.shared_phones
                     (phone_tail, sale_id, stove_id, phone_as_written, source, confirmed,
                      note, created_by, updated_by)
                   select $1, s.id, s.stove_serial_no, s.phone, 'call_centre', true, $3, $2, $2
                     from public.sales s
                    where s.is_archived is not true
                      and (s.id = $4::uuid
                           or right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = $1)
                   on conflict (phone_tail, sale_id) do update
                      set source = 'call_centre', confirmed = true,
                          note = coalesce(excluded.note, data_center.shared_phones.note),
                          stove_id = excluded.stove_id,
                          phone_as_written = excluded.phone_as_written,
                          updated_at = now(), updated_by = excluded.updated_by
                   returning sale_id::text, stove_id as stove_serial_no`,
            args: [tail, userId, note, saleId],
          });

          await conn.queryObject("commit");
          return json(
            { data: { phoneTail: tail, stoves: written.rows } },
            200,
            cors,
          );
        } catch (err) {
          await conn.queryObject("rollback");
          throw err;
        }
      }

      default:
        return json(
          { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
          400,
          cors,
        );
    }
  } catch (err) {
    if (err instanceof BadRequest) {
      return json({ error: err.message, code: "bad_request" }, 400, resolveCors(req));
    }
    if (err instanceof Conflict) {
      return json({ error: err.message, code: "conflict" }, 409, resolveCors(req));
    }
    console.error("[data-center-write]", err);
    return json({ error: "Data Center write failed", code: "internal" }, 500, resolveCors(req));
  } finally {
    await closeConnection(conn);
  }
});

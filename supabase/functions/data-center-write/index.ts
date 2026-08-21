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

const VERIFICATION_OUTCOMES = new Set([
  "fully_verified", "partially_verified", "not_verified",
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
                   has_call_record, call_record_version, call_record_updated_at
                 from data_center.v_call_center where sale_id = $1`,
          args: [saleId],
        });
        if (record.rows.length === 0) {
          return json({ error: "No such sale", code: "not_found" }, 404, cors);
        }
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
          { data: { record: record.rows[0], attempts: attempts.rows } },
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

          await conn!.queryObject("commit");
          return json({ data: { saleId, version: updated.rows[0]?.version } }, 200, cors);
        } catch (err) {
          await conn!.queryObject("rollback");
          throw err;
        }
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

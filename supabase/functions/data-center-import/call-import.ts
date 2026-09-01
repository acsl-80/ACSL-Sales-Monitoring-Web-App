// Data Center: bulk import of call-centre work.
//
// Agents kept their own spreadsheets since before this module existed. One
// week of the workbook holds 359 stove IDs, and before this file the only way
// in was the call form, one record at a time.
//
// HOW THIS DIFFERS FROM THE RECEIPT IMPORT, AND WHY THAT IS NOT A SECOND
// VALIDATOR
//
// The module's rule is one validator whatever the channel: a typed receipt and
// an uploaded receipt are the same act at different speeds, so they share a
// path. A call record is a different subject. This import MATCHES sales, it
// never creates one, because a phone call cannot bring a stove into existence.
// A row whose stove ID finds no sale is an exception for a person to look at.
//
// What it shares is the machinery: the same `import_batches` and
// `import_rows`, the same staged/validated/committed lifecycle, the same
// exceptions queue, and now the same three chain primitives from
// `_shared/import-chain.ts`.
//
// WHY IT DOES NOT SHARE THE RECEIPT COMMIT ITSELF
//
// That was tried on paper and refused. `import_claims`' primary key IS the
// lock and it is a stove serial; the stock lateral runs inside the receipt
// lease transaction; orphan adoption and the shared-phone register run inside
// its outcome transaction. Sharing it would have meant seven to nine strategy
// callbacks, three of them returning SQL, and a migration against a live
// table. So the three parts with one right answer are shared and the rest is
// this file's own, which is about a hundred lines.
//
// AND IT DOES NOT WRITE call_records DIRECTLY
//
// Commit posts to data-center-write, the same `save_call_record` and
// `log_attempt` the call form uses. That is the receipt import's own rule
// (never insert into public.sales, always go through create-sale) applied to
// this side: field visibility, the answers-versus-column routing in
// splitPayload, the writable-column allowlist and the audit trigger all stay
// in one place. A question promoted from jsonb to a real column later needs no
// change here.
//
// WHAT UPDATE MODE CHANGED
//
// The sheet used to be single-use: it carried only never-called records and
// refused anything that already had one. `save_call_record` has always been an
// upsert with an `expectedVersion`, so that was a policy, not a limit. Now a
// row may update, guarded by the version it was downloaded with, and only the
// call dates the record does not already hold are logged - otherwise a second
// upload of the same sheet would write six attempts where it stated three.

import { withConnection, type PoolClient } from "../_shared/data-center-db.ts";
import { readSheetDate } from "../_shared/data-center-dates.ts";

export const CALL_SOURCE = "call_center";

/** The writable call-record columns, keyed by the sheet's own field names. */
const COLUMN_FOR: Record<string, string> = {
  correctedName: "corrected_end_user_name",
  correctedPhone: "corrected_phone",
  correctedAltPhone: "corrected_alt_phone",
  correctedAddress: "corrected_address",
  correctedState: "corrected_state",
  correctedLga: "corrected_lga",
  ward: "ward",
  landmark: "landmark",
  statedSerial: "stated_serial",
  comments: "other_comments",
};

const DATE_FIELDS = ["callDate1", "callDate2", "callDate3"] as const;

export type SheetColumn = {
  field: string;
  header: string;
  locked?: boolean;
  required?: boolean;
  type?: string;
  optionList?: string;
  choices?: { value: string; label: string }[];
  help?: string;
};

export type CallRegistryQuestion = {
  key: string;
  label: string;
  input_type: string;
  option_list_key: string | null;
};

export type CallSheetSpec = {
  columns: SheetColumn[];
  questions: CallRegistryQuestion[];
  format: string;
};

/**
 * The sheet, from the registry rather than from this file.
 *
 * `call_centre.sheet_columns` carries the call-specific columns; the questions
 * are appended from `field_defs` so retiring one in Settings removes it from
 * the sheet with no release. Restating them here would be a second copy that
 * drifts the first time somebody edits the form.
 */
export async function callSheetSpec(conn: PoolClient): Promise<CallSheetSpec> {
  const cfg = await conn.queryObject<{ key: string; value: unknown }>({
    text: `select key, value from data_center.workflow_config
            where key in ('call_centre.sheet_columns', 'call_centre.sheet_format')`,
  });
  const byKey = new Map(cfg.rows.map((r) => [r.key, r.value]));

  const q = await conn.queryObject<CallRegistryQuestion>({
    text: `select key, label, input_type, option_list_key
             from data_center.field_defs
            where is_active and retired_at is null
            order by sort_order, key`,
  });

  return {
    columns: (byKey.get("call_centre.sheet_columns") ?? []) as SheetColumn[],
    questions: q.rows,
    format: String(byKey.get("call_centre.sheet_format") ?? "xlsx").replace(/"/g, ""),
  };
}

type OptionRow = { id: string; list_key: string; value: string; label: string };

/** Every active option, reachable by label OR by value, case-insensitively. */
async function optionIndex(conn: PoolClient) {
  const r = await conn.queryObject<OptionRow>({
    text: `select id::text, list_key, value, label
             from data_center.option_values where is_active`,
  });
  const byLabel = new Map<string, OptionRow>();
  for (const row of r.rows) {
    // Both spellings are accepted on the way in. An agent's sheet carries the
    // label they read on screen; a sheet round-tripped through an export
    // carries the value. Refusing either would be refusing the file for a
    // reason nobody could see.
    byLabel.set(`${row.list_key} ${row.label.trim().toLowerCase()}`, row);
    byLabel.set(`${row.list_key} ${row.value.trim().toLowerCase()}`, row);
  }
  return byLabel;
}

function pick(raw: Record<string, unknown>, field: string, header: string): string {
  for (const k of [field, header]) {
    const v = raw[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  // Headers vary by case and spacing in a real file.
  const wanted = header.trim().toLowerCase();
  for (const [k, v] of Object.entries(raw)) {
    if (k.trim().toLowerCase() === wanted && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

export type CallAttempt = {
  attemptedAt: string;
  outcomeId?: string;
  agentId?: string;
  answeredById?: string;
};

export type NormalizedCall = {
  serial: string;
  values: Record<string, unknown>;
  attempts: CallAttempt[];
  /** The `call_records.version` this row was downloaded against, if any. */
  sheetVersion: number | null;
  problem: string | null;
  hint: string | null;
};

/**
 * One row of the sheet, turned into what data-center-write expects.
 *
 * Every failure here is a `problem`, never a silently dropped value. An option
 * label the registry does not know is the most likely one in a real file, and
 * it names the column and the value, because "Unreacheable" is a typo somebody
 * can fix in ten seconds once they are told which cell it is in.
 *
 * Each problem now carries a `hint` as well. The receipt path has had
 * reason-plus-hint since 20260821080000 and this side never did, so every call
 * refusal arrived as a complaint with no remedy - and the rework export's
 * "How to fix it" column would have been empty for all of them.
 */
export function normalizeCallRow(
  raw: Record<string, unknown>,
  spec: CallSheetSpec,
  options: Map<string, OptionRow>,
): NormalizedCall {
  const values: Record<string, unknown> = {};
  const attempts: CallAttempt[] = [];
  const byField = new Map(spec.columns.map((c) => [c.field, c]));

  const serialCol = byField.get("stoveSerialNo");
  const serial = pick(raw, "stoveSerialNo", serialCol?.header ?? "Stove ID").toUpperCase();
  if (!serial) {
    return {
      serial: "",
      values,
      attempts,
      sheetVersion: null,
      problem: "No Stove ID in this row",
      hint: "Every row needs the Stove ID exactly as the sheet supplied it. An empty row can simply be deleted.",
    };
  }

  // The version the sheet was built from, for update mode. Absent on a sheet
  // downloaded before the column existed, which validate treats as a reason to
  // refuse an update rather than to guess.
  const versionCol = byField.get("recordVersion");
  const versionText = versionCol ? pick(raw, versionCol.field, versionCol.header) : "";
  const parsedVersion = versionText ? Number(versionText.replace(/[, ]/g, "")) : NaN;
  const sheetVersion = Number.isFinite(parsedVersion) ? parsedVersion : null;

  const resolve = (col: SheetColumn, listKey: string, want: "id" | "value") => {
    const text = pick(raw, col.field, col.header);
    if (!text) return null;
    const hit = options.get(`${listKey} ${text.toLowerCase()}`);
    if (!hit) {
      throw new Error(
        `${col.header} reads "${text}", which is not one of the choices. ` +
          "Use the dropdown in the sheet, or correct it in Settings if the choice should exist.",
      );
    }
    return want === "id" ? hit.id : hit.value;
  };

  try {
    // ---- the writable columns -------------------------------------------
    for (const [field, column] of Object.entries(COLUMN_FOR)) {
      const col = byField.get(field);
      const text = pick(raw, field, col?.header ?? field);
      if (text) values[column] = text;
    }

    // ---- verification, from explicit choices -----------------------------
    const verCol = byField.get("verification");
    if (verCol) {
      const text = pick(raw, verCol.field, verCol.header);
      if (text) {
        const hit = (verCol.choices ?? []).find(
          (c) =>
            c.value.toLowerCase() === text.toLowerCase() ||
            c.label.toLowerCase() === text.toLowerCase(),
        );
        if (!hit) {
          throw new Error(
            `${verCol.header} reads "${text}", which is not one of the choices.`,
          );
        }
        values.verification_outcome = hit.value;
      }
    }

    // ---- the registry-backed dropdowns -----------------------------------
    const outcomeCol = byField.get("callOutcome");
    const outcomeId = outcomeCol
      ? resolve(outcomeCol, outcomeCol.optionList ?? "call_outcome", "id")
      : null;
    if (outcomeId) values.call_outcome_id = outcomeId;

    const agentCol = byField.get("callAgent");
    const agentId = agentCol ? resolve(agentCol, agentCol.optionList ?? "agent_name", "id") : null;
    if (agentId) values.call_agent_id = agentId;

    const answeredCol = byField.get("answeredBy");
    const answeredById = answeredCol
      ? resolve(answeredCol, answeredCol.optionList ?? "answered_by", "id")
      : null;

    // ---- the 13 questions, straight from field_defs ------------------------
    for (const q of spec.questions) {
      const text = pick(raw, q.key, q.label);
      if (!text) continue;
      if (q.input_type === "select" && q.option_list_key) {
        const hit = options.get(`${q.option_list_key} ${text.toLowerCase()}`);
        if (!hit) {
          throw new Error(
            `"${q.label}" reads "${text}", which is not one of the choices for that question.`,
          );
        }
        values[q.key] = hit.value;
      } else if (q.input_type === "number") {
        const n = Number(text.replace(/[, ]/g, ""));
        if (!Number.isFinite(n)) {
          throw new Error(`"${q.label}" reads "${text}", which is not a number.`);
        }
        values[q.key] = n;
      } else {
        values[q.key] = text;
      }
    }

    // ---- the call dates become attempts ------------------------------------
    for (const field of DATE_FIELDS) {
      const col = byField.get(field);
      const iso = readSheetDate(pick(raw, field, col?.header ?? field), col?.header ?? field);
      if (iso) attempts.push({ attemptedAt: iso });
    }
    // In date order, because log_attempt numbers each one max+1 as it arrives.
    attempts.sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));

    /*
     * The outcome belongs to the LAST attempt, not to all of them.
     *
     * The sheet records one outcome for the record, and log_attempt copies
     * whatever it is given onto the record's headline outcome. Attaching it to
     * every attempt would rewrite the headline three times and describe the
     * first call as having ended the way the third did.
     */
    if (attempts.length > 0) {
      const last = attempts[attempts.length - 1];
      if (outcomeId) last.outcomeId = outcomeId;
      if (agentId) last.agentId = agentId;
      if (answeredById) last.answeredById = answeredById;
    }

    return { serial, values, attempts, sheetVersion, problem: null, hint: null };
  } catch (err) {
    return {
      serial,
      values,
      attempts,
      sheetVersion,
      problem: err instanceof Error ? err.message : "This row could not be read",
      hint: "Open the sheet, correct that cell using its dropdown, and upload the file again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/**
 * Stage every row in ONE statement.
 *
 * This was a `for` loop with an `await` inside, so a 20,000-row file - the
 * ceiling `import.max_rows` allows - made 20,000 round trips inside one
 * transaction. The receipt path has staged with `jsonb_array_elements ...
 * with ordinality` since it was written, for exactly the reason
 * `_shared/data-center-db.ts` gives: statements per request is the number
 * worth minimising, because the round trip costs far more than the query.
 */
export async function stageCallRows(
  conn: PoolClient,
  batchId: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  await conn.queryObject({
    text: `insert into data_center.import_rows (batch_id, row_number, raw, status)
           select $1, ordinality, value, 'pending'
             from jsonb_array_elements($2::jsonb) with ordinality`,
    args: [batchId, JSON.stringify(rows)],
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Verdict = {
  id: string;
  status: "valid" | "exception" | "rejected";
  stove_serial_no: string | null;
  sale_id: string | null;
  normalized: string | null;
  exception_reason: string | null;
  rejection_reason: string | null;
  rejection_hint: string | null;
};

export type CallValidateSummary = {
  total: number;
  valid: number;
  exceptions: number;
  rejected: number;
  /** Of the valid rows, how many would create a record and how many update one. */
  creating: number;
  updating: number;
};

/**
 * Match every staged row to exactly one live sale, and say why when it cannot.
 *
 * Rewritten from a per-row loop that issued three statements per row. On the
 * 359-row weekly workbook that was over a thousand round trips; the receipt
 * path measured the same shape at 22.2 seconds for 200 rows, which is past the
 * client's twenty-second abort. Everything below reads in a fixed number of
 * queries and writes once.
 */
export async function validateCallRows(
  conn: PoolClient,
  args: {
    batchId: string;
    userId: string;
    ownOrganizationId: string | null;
    superAdmin: boolean;
    updateExisting: boolean;
  },
): Promise<CallValidateSummary> {
  const { batchId, userId, ownOrganizationId, superAdmin, updateExisting } = args;

  const spec = await callSheetSpec(conn);
  const options = await optionIndex(conn);

  const staged = await conn.queryObject<
    { id: string; row_number: number; raw: Record<string, unknown> }
  >({
    text: `select id::text, row_number, raw from data_center.import_rows
            where batch_id = $1 and status in ('pending', 'draft', 'valid', 'exception')
            order by row_number`,
    args: [batchId],
  });

  const norms = staged.rows.map((r) => ({
    row: r,
    norm: normalizeCallRow(r.raw ?? {}, spec, options),
  }));

  // ---- one query for every serial ------------------------------------------
  const serials = [...new Set(norms.map((n) => n.norm.serial).filter(Boolean))];
  type SaleHit = { serial: string; id: string; in_scope: boolean };
  const sales = serials.length === 0
    ? []
    : (await conn.queryObject<SaleHit>({
      // Scope is computed per row rather than filtered, so "belongs to a
      // partner you do not cover" can be said out loud instead of arriving as
      // the indistinguishable "no sale recorded yet".
      text: `select upper(btrim(s.stove_serial_no)) as serial,
                    s.id::text as id,
                    ($3::boolean
                     or s.organization_id = $2
                     or s.organization_id in (
                          select organization_id
                            from public.acsl_agent_org_scope(array[$1::uuid]))) as in_scope
               from public.sales s
              where upper(btrim(s.stove_serial_no)) = any($4::text[])
                and s.is_archived is not true`,
      args: [userId, ownOrganizationId, superAdmin, serials],
    })).rows;

  const bySerial = new Map<string, SaleHit[]>();
  for (const s of sales) {
    const list = bySerial.get(s.serial) ?? [];
    list.push(s);
    bySerial.set(s.serial, list);
  }

  // ---- one query for existing records, one for existing attempts -----------
  const saleIds = [...new Set(sales.map((s) => s.id))];
  const existing = saleIds.length === 0
    ? new Map<string, number>()
    : new Map(
      (await conn.queryObject<{ sale_id: string; version: number }>({
        text: `select sale_id::text, version from data_center.call_records
                where sale_id = any($1::uuid[])`,
        args: [saleIds],
      })).rows.map((r) => [r.sale_id, Number(r.version)]),
    );

  const attemptDates = new Map<string, Set<string>>();
  if (saleIds.length > 0) {
    const r = await conn.queryObject<{ sale_id: string; on_day: string }>({
      text: `select sale_id::text, to_char(attempted_at, 'YYYY-MM-DD') as on_day
               from data_center.call_attempts where sale_id = any($1::uuid[])`,
      args: [saleIds],
    });
    for (const a of r.rows) {
      const set = attemptDates.get(a.sale_id) ?? new Set<string>();
      set.add(a.on_day);
      attemptDates.set(a.sale_id, set);
    }
  }

  // ---- verdicts, in memory -------------------------------------------------
  const verdicts: Verdict[] = [];
  const firstSeen = new Map<string, number>();
  let valid = 0, exceptions = 0, rejected = 0, creating = 0, updating = 0;

  for (const { row, norm } of norms) {
    const base = {
      id: row.id,
      stove_serial_no: norm.serial || null,
      sale_id: null as string | null,
      normalized: null as string | null,
      exception_reason: null as string | null,
      rejection_reason: null as string | null,
      rejection_hint: null as string | null,
    };

    // Unreadable: no identity at all. The only rejection this import has.
    if (!norm.serial) {
      verdicts.push({
        ...base,
        status: "rejected",
        rejection_reason: norm.problem ?? "No Stove ID in this row",
        rejection_hint: norm.hint,
      });
      rejected++;
      continue;
    }

    const except = (reason: string) => {
      verdicts.push({ ...base, status: "exception", exception_reason: reason });
      exceptions++;
    };

    /*
     * An unreadable cell is named BEFORE the duplicate check, which is the
     * opposite of the receipt path's ordering, and deliberately.
     *
     * There, a repeated serial would create a second SALE, which is the graver
     * outcome, so it leads. Here a repeat means a second update to one record,
     * which the version check refuses anyway. Naming the cell first means
     * "Unreacheable" is reported as the ten-second fix it is, rather than
     * being hidden behind "this repeats row 3".
     */
    if (norm.problem) {
      except(norm.problem);
      continue;
    }

    const seenAt = firstSeen.get(norm.serial);
    if (seenAt !== undefined) {
      except(
        `Stove ${norm.serial} already appears on row ${seenAt} of this file. ` +
          "Only the first row for a stove is used; delete the repeat or merge the two.",
      );
      continue;
    }
    firstSeen.set(norm.serial, row.row_number);

    const hits = bySerial.get(norm.serial) ?? [];
    if (hits.length === 0) {
      except(
        `Stove ${norm.serial} has no sale recorded yet. The receipt has to be ` +
          "digitalised before a call can be attached to it.",
      );
      continue;
    }
    if (hits.length > 1) {
      except(
        `Stove ${norm.serial} matches ${hits.length} live sales, so there is ` +
          "no way to tell which one this call belongs to.",
      );
      continue;
    }

    const hit = hits[0];
    if (!hit.in_scope) {
      except(
        `Stove ${norm.serial} belongs to a partner you do not cover, so this ` +
          "call cannot be attached to it. Ask for the partner to be assigned to you.",
      );
      continue;
    }

    const currentVersion = existing.get(hit.id);
    let mode: "new" | "update" = "new";
    let expectedVersion: number | null = null;

    if (currentVersion !== undefined) {
      if (!updateExisting) {
        except(
          `Stove ${norm.serial} already has a call record in the system. ` +
            "Nothing was changed; open the record if the sheet is more recent.",
        );
        continue;
      }
      if (norm.sheetVersion === null) {
        except(
          `Stove ${norm.serial} already has a call record, and this row carries no ` +
            "Record Version, so there is no way to tell whether the sheet is newer " +
            "than the record. Download the sheet again and re-enter this row.",
        );
        continue;
      }
      if (norm.sheetVersion !== currentVersion) {
        except(
          `Stove ${norm.serial} changed in the app after this sheet was downloaded ` +
            `(the sheet has version ${norm.sheetVersion}, the record is now at ` +
            `${currentVersion}). Nothing was changed. Download the sheet again to ` +
            "see what the record says now.",
        );
        continue;
      }
      mode = "update";
      expectedVersion = currentVersion;
      updating++;
    } else {
      creating++;
    }

    /*
     * Only the call dates this record does not already hold.
     *
     * `log_attempt` numbers each arrival max+1, so re-uploading a sheet that
     * states three dates against a record that already has them would write
     * six attempts and report the backlog as chased twice as often as it was.
     */
    const already = attemptDates.get(hit.id) ?? new Set<string>();
    const fresh = norm.attempts.filter((a) => !already.has(a.attemptedAt.slice(0, 10)));

    verdicts.push({
      ...base,
      status: "valid",
      sale_id: hit.id,
      normalized: JSON.stringify({
        values: norm.values,
        attempts: fresh,
        mode,
        expectedVersion,
      }),
    });
    valid++;
  }

  // ---- one write -----------------------------------------------------------
  if (verdicts.length > 0) {
    await conn.queryObject({
      text: `update data_center.import_rows r
                set status           = v.status,
                    stove_serial_no  = v.stove_serial_no,
                    sale_id          = v.sale_id::uuid,
                    normalized       = v.normalized::jsonb,
                    exception_reason = v.exception_reason,
                    rejection_reason = v.rejection_reason,
                    rejection_hint   = v.rejection_hint
               from jsonb_to_recordset($1::jsonb) as v(
                      id uuid, status text, stove_serial_no text, sale_id text,
                      normalized text, exception_reason text,
                      rejection_reason text, rejection_hint text
                    )
              where r.id = v.id`,
      args: [JSON.stringify(verdicts)],
    });
  }

  await conn.queryObject({
    text: `update data_center.import_batches
              set state = 'validated', total_rows = $2, valid_rows = $3, rejected_rows = $4
            where id = $1`,
    args: [batchId, staged.rows.length, valid, rejected + exceptions],
  });

  return { total: staged.rows.length, valid, exceptions, rejected, creating, updating };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export type CallSliceOutcome = {
  committed: number;
  failed: number;
  left: number;
  processed: number;
};

type CallPayload = {
  values: Record<string, unknown>;
  attempts: CallAttempt[];
  mode?: "new" | "update";
  expectedVersion?: number | null;
};

/**
 * One time-budgeted slice of a call commit.
 *
 * Budgeted rather than row-counted, for the reason the receipt path learned
 * the hard way: per-row latency is not a constant, so no fixed slice size is
 * right at both ends. Here each row is one `save_call_record` plus up to three
 * `log_attempt` posts, each of which is a separate edge-function invocation
 * paying its own connection setup, so a 25-row slice was 25 to 100 sequential
 * invocations - comfortably past the client's twenty-second abort, which is
 * why this could never finish a real sheet.
 *
 * Outcomes are collected and written in ONE transaction at the end rather than
 * two statements per row.
 */
export async function commitCallSlice(
  args: {
    batchId: string;
    userId: string;
    budgetMs: number;
    cap: number;
    post: (
      action: string,
      payload: Record<string, unknown>,
    ) => Promise<{ ok: boolean; detail: string }>;
  },
): Promise<CallSliceOutcome> {
  const { batchId, userId, budgetMs, cap, post } = args;

  /*
   * Three connections, not one held throughout.
   *
   * The posts below are HTTP calls that can run for the whole slice budget,
   * and holding a Postgres connection across them would tie one up for every
   * concurrent commit. This module's own connection policy exists because a
   * pooled version took the database down and refused PostgREST with it, so a
   * connection is opened for the read, dropped for the slow work, and opened
   * again for the write. That is the shape the receipt commit uses too.
   */
  const slice = await withConnection((conn) =>
    conn.queryObject<{
      id: string;
      sale_id: string;
      normalized: CallPayload | null;
    }>({
      text: `select id::text, sale_id::text, normalized from data_center.import_rows
              where batch_id = $1 and status = 'valid' and sale_id is not null
              order by row_number limit $2`,
      args: [batchId, cap],
    })
  );

  const t0 = Date.now();
  const ok: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  let processed = 0;

  for (const row of slice.rows) {
    // At least one row per link, then stop starting new ones. An in-flight
    // save may overrun the budget; that is fine, the next link picks up.
    if (processed > 0 && Date.now() - t0 > budgetMs) break;
    processed++;

    const payload: CallPayload = row.normalized ?? { values: {}, attempts: [] };

    const saved = await post("save_call_record", {
      saleId: row.sale_id,
      values: payload.values ?? {},
      // Only for an update. A new record has no version to disagree with, and
      // sending one would make save_call_record refuse a record it is about
      // to create.
      ...(payload.mode === "update" && payload.expectedVersion !== null
        ? { version: payload.expectedVersion }
        : {}),
    });
    if (!saved.ok) {
      failed.push({ id: row.id, reason: saved.detail.slice(0, 400) });
      continue;
    }

    let attemptTrouble: string | null = null;
    for (const attempt of payload.attempts ?? []) {
      const logged = await post("log_attempt", {
        saleId: row.sale_id,
        attemptedAt: attempt.attemptedAt,
        outcomeId: attempt.outcomeId ?? null,
        agentId: attempt.agentId ?? null,
        answeredById: attempt.answeredById ?? null,
        note: "Imported from the call-centre sheet",
      });
      // A record that saved but whose attempts did not is still worth having,
      // so this is recorded against the row and does not undo the record.
      if (!logged.ok && !attemptTrouble) attemptTrouble = logged.detail.slice(0, 300);
    }

    if (attemptTrouble) {
      failed.push({
        id: row.id,
        reason: `The record saved but a call date did not: ${attemptTrouble}`,
      });
      continue;
    }
    ok.push(row.id);
  }

  // ---- every outcome, one transaction --------------------------------------
  return await withConnection(async (conn) => {
    await conn.queryObject("begin");
    try {
      await conn.queryObject({
        text: "select set_config('data_center.actor', $1, true)",
        args: [userId],
      });

      if (ok.length > 0) {
        await conn.queryObject({
          text: `update data_center.import_rows
                    set status = 'committed', resolved_by = $2, resolved_at = now(),
                        confirmed_by = $2, confirmed_at = now()
                  where id = any($1::uuid[])`,
          args: [ok, userId],
        });
      }
      if (failed.length > 0) {
        await conn.queryObject({
          text: `update data_center.import_rows r
                    set status = 'exception', exception_reason = u.reason
                   from unnest($1::uuid[], $2::text[]) as u(id, reason)
                  where r.id = u.id`,
          args: [failed.map((f) => f.id), failed.map((f) => f.reason)],
        });
      }

      const left = await conn.queryObject<{ n: number }>({
        text: `select count(*)::int n from data_center.import_rows
                where batch_id = $1 and status = 'valid' and sale_id is not null`,
        args: [batchId],
      });
      const remaining = left.rows[0]?.n ?? 0;

      await conn.queryObject({
        text: `update data_center.import_batches
                  set committed_rows = (select count(*) from data_center.import_rows
                                         where batch_id = $1 and status = 'committed'),
                      state = case when $2 = 0 then 'committed' else 'validated' end,
                      committed_at = case when $2 = 0 then now() else committed_at end,
                      committed_by = case when $2 = 0 then $3 else committed_by end
                where id = $1`,
        args: [batchId, remaining, userId],
      });

      await conn.queryObject("commit");
      return { committed: ok.length, failed: failed.length, left: remaining, processed };
    } catch (err) {
      await conn.queryObject("rollback");
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Undo a call import.
 *
 * Deletes the call records this batch created and NOTHING else. The receipt
 * import's rollback goes through delete-sale and takes the sale with it; doing
 * that here would delete a sale because somebody mis-typed a call outcome.
 *
 * NOTE ON WHAT THIS CANNOT DO, now that update mode exists. A row that
 * UPDATED an existing record cannot be undone by deleting that record: the
 * record was not this batch's to remove, and deleting it would throw away
 * whatever the first call found. Those rows are reported rather than reversed,
 * and the count is named so nobody reads "reversed 40" as "all 60 undone".
 *
 * Runs in one transaction, which it did not before: the three statements were
 * separately committed, so a failure between them left the batch half-undone
 * with nothing saying so.
 */
export async function rollbackCallRows(
  conn: PoolClient,
  batchId: string,
  userId: string,
): Promise<{ reversed: number; notReversed: number; remaining: number; done: boolean }> {
  await conn.queryObject("begin");
  try {
    await conn.queryObject({
      text: "select set_config('data_center.actor', $1, true)",
      args: [userId],
    });

    // Rows this batch CREATED, which are the only ones it may remove.
    const created = await conn.queryObject<{ sale_id: string }>({
      text: `select sale_id::text from data_center.import_rows
              where batch_id = $1 and status = 'committed' and sale_id is not null
                and coalesce(normalized ->> 'mode', 'new') = 'new'`,
      args: [batchId],
    });
    const updated = await conn.queryObject<{ n: number }>({
      text: `select count(*)::int n from data_center.import_rows
              where batch_id = $1 and status = 'committed' and sale_id is not null
                and normalized ->> 'mode' = 'update'`,
      args: [batchId],
    });

    let reversed = 0;
    if (created.rows.length > 0) {
      const gone = await conn.queryObject<{ n: number }>({
        text: `with gone as (
                 delete from data_center.call_records
                  where sale_id = any($1::uuid[])
                 returning sale_id)
               select count(*)::int n from gone`,
        args: [created.rows.map((r) => r.sale_id)],
      });
      reversed = gone.rows[0]?.n ?? 0;
    }

    await conn.queryObject({
      text: `update data_center.import_rows
                set status = 'valid', confirmed_at = null, confirmed_by = null
              where batch_id = $1 and status = 'committed'`,
      args: [batchId],
    });

    await conn.queryObject({
      text: `update data_center.import_batches
                set state = 'rolled_back', committed_rows = 0 where id = $1`,
      args: [batchId],
    });

    await conn.queryObject("commit");
    return {
      reversed,
      notReversed: updated.rows[0]?.n ?? 0,
      remaining: 0,
      done: true,
    };
  } catch (err) {
    await conn.queryObject("rollback");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fixing one row
// ---------------------------------------------------------------------------

/**
 * Correct the stove ID on one exception row and re-check just that row.
 *
 * The receipt import has had this since it was written; this side never did,
 * so the only way to fix a mistyped serial was to edit the file and upload it
 * again. On a sheet where one exception is a typo and thirty are receipts that
 * have not been digitalised yet, that is a round trip for one cell.
 *
 * IT MUST SET sale_id, AND THAT IS THE WHOLE POINT
 *
 * The receipt version, pointed at a call row, set `status = 'valid'` and left
 * `sale_id` null - and `commitCallSlice` selects `status = 'valid' and sale_id
 * is not null`. The row was then neither committed nor listed as an exception
 * anywhere: it stopped existing. This one re-derives the match, so a row that
 * goes valid is a row that can actually land.
 *
 * Re-normalised from `raw` rather than patched, because the corrected serial
 * may point at a different sale with different attempts already logged, and
 * carrying the old row's computed attempts across would re-log calls the new
 * record already holds.
 */
export async function resolveCallException(
  conn: PoolClient,
  args: {
    rowId: string;
    serial: string;
    userId: string;
    ownOrganizationId: string | null;
    superAdmin: boolean;
    updateExisting: boolean;
  },
): Promise<{ resolved: boolean; reason: string | null }> {
  const { rowId, serial, userId, ownOrganizationId, superAdmin, updateExisting } = args;

  const row = await conn.queryObject<{ raw: Record<string, unknown>; batch_id: string }>({
    text: `select raw, batch_id::text from data_center.import_rows
            where id = $1 for update`,
    args: [rowId],
  });
  if (row.rows.length === 0) throw new Error("No such row");

  const spec = await callSheetSpec(conn);
  const options = await optionIndex(conn);
  const norm = normalizeCallRow(
    { ...(row.rows[0].raw ?? {}), stoveSerialNo: serial },
    spec,
    options,
  );

  let reason: string | null = norm.problem;
  let saleId: string | null = null;
  let mode: "new" | "update" = "new";
  let expectedVersion: number | null = null;
  let attempts = norm.attempts;

  if (!reason) {
    const hits = await conn.queryObject<{ id: string; in_scope: boolean }>({
      text: `select s.id::text as id,
                    ($3::boolean
                     or s.organization_id = $2
                     or s.organization_id in (
                          select organization_id
                            from public.acsl_agent_org_scope(array[$1::uuid]))) as in_scope
               from public.sales s
              where upper(btrim(s.stove_serial_no)) = $4
                and s.is_archived is not true`,
      args: [userId, ownOrganizationId, superAdmin, serial],
    });

    if (hits.rows.length === 0) {
      reason =
        `Stove ${serial} has no sale recorded yet. The receipt has to be ` +
        "digitalised before a call can be attached to it.";
    } else if (hits.rows.length > 1) {
      reason =
        `Stove ${serial} matches ${hits.rows.length} live sales, so there is ` +
        "no way to tell which one this call belongs to.";
    } else if (!hits.rows[0].in_scope) {
      reason =
        `Stove ${serial} belongs to a partner you do not cover, so this call ` +
        "cannot be attached to it.";
    } else {
      saleId = hits.rows[0].id;
      const existing = await conn.queryObject<{ version: number }>({
        text: `select version from data_center.call_records where sale_id = $1`,
        args: [saleId],
      });
      if (existing.rows.length > 0) {
        const current = Number(existing.rows[0].version);
        if (!updateExisting) {
          reason = `Stove ${serial} already has a call record in the system.`;
          saleId = null;
        } else if (norm.sheetVersion !== current) {
          /*
           * A corrected serial almost always lands on a record this sheet
           * never saw, so its version cannot match. Refusing is the safe
           * direction and the message says why rather than reading as a
           * version bug: the row's answers were typed against one stove and
           * are now being pointed at another that somebody has already worked.
           */
          reason =
            `Stove ${serial} already has a call record, and this sheet was not built ` +
            "from it, so attaching these answers would overwrite work you have not " +
            "seen. Open that record in the call centre, or download a fresh sheet.";
          saleId = null;
        } else {
          mode = "update";
          expectedVersion = current;
        }
      }

      if (saleId) {
        const already = await conn.queryObject<{ on_day: string }>({
          text: `select to_char(attempted_at, 'YYYY-MM-DD') as on_day
                   from data_center.call_attempts where sale_id = $1`,
          args: [saleId],
        });
        const have = new Set(already.rows.map((a) => a.on_day));
        attempts = norm.attempts.filter((a) => !have.has(a.attemptedAt.slice(0, 10)));
      }
    }
  }

  await conn.queryObject({
    text: `update data_center.import_rows
              set corrected_serial  = $2,
                  stove_serial_no   = $2,
                  sale_id           = $3::uuid,
                  normalized        = $4::jsonb,
                  status            = case when $5::text is null then 'valid' else 'exception' end,
                  exception_reason  = $5,
                  rejection_reason  = null,
                  rejection_hint    = null,
                  resolved_by       = $6,
                  resolved_at       = now()
            where id = $1`,
    args: [
      rowId,
      serial,
      saleId,
      JSON.stringify({ values: norm.values, attempts, mode, expectedVersion }),
      reason,
      userId,
    ],
  });

  // Recount rather than adjust. A counter nudged by hand drifts the moment
  // anything else touches the batch.
  await conn.queryObject({
    text: `update data_center.import_batches b
              set valid_rows    = (select count(*) from data_center.import_rows r
                                    where r.batch_id = b.id and r.status = 'valid'),
                  rejected_rows = (select count(*) from data_center.import_rows r
                                    where r.batch_id = b.id and r.status in ('rejected','exception'))
            where b.id = $1`,
    args: [row.rows[0].batch_id],
  });

  return { resolved: reason === null, reason };
}

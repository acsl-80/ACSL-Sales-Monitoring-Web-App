// Data Center: access administration.
//
// Grants and revokes module access (viewer / editor), searches profiles to
// grant against, and serves the change log. Callable only by a super admin or
// a holder of the grants.manage feature; everyone else gets a 403 no matter
// what the UI showed them.
//
// Every write runs inside a transaction that first sets
// set_config('data_center.actor', <caller>, true), which is how the audit
// trigger knows WHO made the change on a service-role connection where
// auth.uid() means nothing. That is the mechanism behind "changes from
// editors will be tracked" — the trigger writes the log, application code
// never does.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection } from "../_shared/data-center-db.ts";
import { ROLE_FEATURES, featuresFor } from "../_shared/data-center-roles.ts";
import { fieldByKey } from "../_shared/sale-dictionary.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  if (!origin) return true; // non-browser caller, authenticated by bearer token
  const configured = (Deno.env.get("DATA_CENTER_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
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

function isSuperAdmin(role: string | null): boolean {
  return role === "super_admin";
}


/**
 * Read from the shared role table rather than restated here. The three-level UI
 * shipped against a two-entry list, so granting "call agent" came back 400 with
 * a message naming only viewer and editor. One definition means the next level
 * added is accepted the day it exists.
 */
const VALID_ROLES = new Set(Object.keys(ROLE_FEATURES));

/*
 * Shape-checked before it reaches Postgres.
 *
 * The older actions in this file hand a bad id straight to the driver and let
 * the cast fail, which answers 500 for what is a caller's mistake. The
 * send-back actions below check first so the answer says what is wrong.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which part of the module a tracked table belongs to.
 *
 * Kept as SQL so the filter runs in the database, and kept in one place so the
 * UI's chips and the query agree by construction. A table added to the audit
 * triggers without a home here lands in "other", which is visible rather than
 * silently dropped.
 */
const CHANGE_CATEGORY_SQL = `case cl.table_name
  when 'call_records'        then 'call_records'
  when 'call_attempts'       then 'calls'
  when 'record_consignments' then 'documents'
  when 'import_batches'      then 'imports'
  when 'assignment_batches'  then 'assignment'
  when 'module_access'       then 'access'
  when 'feature_grants'      then 'access'
  when 'call_agent_profiles' then 'access'
  when 'workflow_config'     then 'configuration'
  when 'option_lists'        then 'configuration'
  when 'option_values'       then 'configuration'
  when 'field_defs'          then 'configuration'
  else 'other'
end`;

/** A registry key is what code and SQL both have to live with, so it is narrow. */
const KEY_RE = /^[a-z][a-z0-9_]{1,60}$/;

/** The types FieldRenderer can actually draw. A new one needs a renderer. */
const INPUT_TYPES = new Set([
  "text", "textarea", "number", "date", "select", "multiselect", "boolean",
]);

/**
 * Run a write with the caller stamped on it, in one transaction.
 *
 * The audit trigger reads `data_center.actor` from the session, so a write
 * outside this wrapper is a write the change log attributes to nobody. The
 * existing access handlers each rolled their own copy of this; they now share.
 */
async function withActor<T>(
  conn: { queryObject: (q: unknown) => Promise<unknown> },
  actorId: string,
  run: () => Promise<T>,
): Promise<T> {
  await conn.queryObject("begin");
  try {
    await conn.queryObject({
      text: "select set_config('data_center.actor', $1, true)",
      args: [actorId],
    });
    const result = await run();
    await conn.queryObject("commit");
    return result;
  } catch (e) {
    await conn.queryObject("rollback");
    throw e;
  }
}

const CHANGE_CATEGORIES = new Set([
  "call_records", "calls", "documents", "imports",
  "assignment", "access", "configuration", "other",
]);

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

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization header", code: "no_token" }, 401, cors);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: auth, error: authError } = await supabase.auth.getUser(
      authHeader.slice("Bearer ".length),
    );
    if (authError || !auth?.user) {
      return json({ error: "Unauthorized", code: "invalid_token" }, 401, cors);
    }
    const callerId = auth.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }

    // Authority check, server-side, before anything else. The UI hiding the
    // access section is presentation; this is the permission.
    /**
     * Two different jobs reach this function.
     *
     * Granting access needs `grants.manage`. Editing the call form and the
     * runtime settings needs `registry.manage`, which a data manager holds and
     * a grants administrator may not. Gating the whole function on the first
     * meant a data manager could not open Settings at all, so the level that
     * runs the module could not configure it.
     *
     * The level's own keys count as well as an individual grant, which is what
     * `featuresFor` is for: a role is a starting set, not a decoration.
     */
    const held = isSuperAdmin(profile.role)
      ? null
      : await withReadConnection(async (conn) => {
        const r = await conn.queryObject<{ access_role: string | null; keys: string[] }>({
          text: `select m.access_role,
                        coalesce(array_agg(g.feature_key) filter (where g.feature_key is not null),
                                 '{}') as keys
                   from data_center.module_access m
                   left join data_center.feature_grants g on g.user_id = m.user_id
                  where m.user_id = $1
                  group by m.access_role`,
          args: [callerId],
        });
        const row = r.rows[0];
        return row ? featuresFor(row.access_role, row.keys) : [];
      });

    const holds = (key: string) => held === null || held.includes(key);
    if (!holds("grants.manage") && !holds("registry.manage")) {
      return json(
        {
          error:
            "Settings needs either grants.manage, to decide who may use the module, " +
            "or registry.manage, to change what it asks and how it behaves.",
          code: "forbidden",
        },
        403,
        cors,
      );
    }

    /**
     * Reaching this function means the caller may open Settings. Editing the
     * call form is a second permission on top of that, because rewriting the
     * questions every agent answers is a different act from deciding who may
     * log in, and `registry.manage` existed for exactly this and was never
     * enforced anywhere.
     */
    const superAdmin = isSuperAdmin(profile.role);
    const canManageRegistry = holds("registry.manage");
    const canManageGrants = holds("grants.manage");
    const requireRegistry = () =>
      canManageRegistry
        ? null
        : json(
            { error: "This needs the registry.manage permission", code: "no_feature" },
            403,
            cors,
          );

    /**
     * Who may change where send-backs land.
     *
     * Three shoulders, named rather than implied: a super admin, a data
     * manager (through `corrections.route`, which their level carries), and an
     * ACSL agent manager - who runs the people this routing is about and is
     * the one likely to know that Femi Isaac has left and Nkechi now covers
     * his consignments.
     *
     * The app role is checked directly rather than by handing every manager a
     * module grant, because a manager who has never opened the Data Center
     * should still not be the reason a send-back reaches nobody.
     */
    const canRoute =
      superAdmin ||
      holds("corrections.route") ||
      profile.role === "acsl_agent_manager";
    const requireRouting = () =>
      canRoute
        ? null
        : json(
            {
              error:
                "Changing who receives send-backs needs corrections.route, and is " +
                "held by super admins, data managers and ACSL agent managers.",
              code: "no_feature",
            },
            403,
            cors,
          );

    let body: {
      action?: string;
      userId?: string;
      accessRole?: string;
      query?: string;
      limit?: number;
      category?: string;
      featureKey?: string;
      granted?: boolean;
      list?: Record<string, unknown>;
      value?: Record<string, unknown>;
      field?: Record<string, unknown>;
      config?: { key?: string; value?: unknown };
      enabled?: boolean;
      note?: string;
      repKey?: string;
      noAccount?: boolean;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    return await withConnection(async (conn) => {
      switch (body.action) {
        case "access_list": {
          const rows = await conn.queryObject({
            text: `select ma.user_id, ma.access_role, ma.granted_at,
                          p.full_name, p.email, p.role as app_role,
                          gb.full_name as granted_by_name
                   from data_center.module_access ma
                   join public.profiles p on p.id = ma.user_id
                   left join public.profiles gb on gb.id = ma.granted_by
                   order by ma.granted_at desc`,
          });
          return json({ data: rows.rows }, 200, cors);
        }

        case "user_search": {
          const q = (body.query ?? "").trim();
          if (q.length < 2) return json({ data: [] }, 200, cors);
          const rows = await conn.queryObject({
            text: `select p.id, p.full_name, p.email, p.role,
                          ma.access_role as current_access
                   from public.profiles p
                   left join data_center.module_access ma on ma.user_id = p.id
                   where p.email ilike '%' || $1 || '%'
                      or p.full_name ilike '%' || $1 || '%'
                      or p.username ilike '%' || $1 || '%'
                   order by p.full_name nulls last
                   limit 20`,
            args: [q],
          });
          return json({ data: rows.rows }, 200, cors);
        }

        case "access_grant":
        case "access_update": {
          if (!canManageGrants) {
            return json(
              { error: "This needs the grants.manage permission", code: "no_feature" },
              403,
              cors,
            );
          }
          if (!body.userId || !VALID_ROLES.has(body.accessRole ?? "")) {
            return json(
              {
                error: `userId and accessRole (${[...VALID_ROLES].join(", ")}) are required`,
                code: "bad_input",
              },
              400,
              cors,
            );
          }
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [callerId],
            });
            await conn.queryObject({
              text: `insert into data_center.module_access (user_id, access_role, granted_by)
                     values ($1, $2, $3)
                     on conflict (user_id) do update
                       set access_role = excluded.access_role,
                           updated_by = $3, updated_at = now()`,
              args: [body.userId, body.accessRole, callerId],
            });
            await conn.queryObject("commit");
          } catch (e) {
            await conn.queryObject("rollback");
            throw e;
          }
          return json({ data: { userId: body.userId, accessRole: body.accessRole } }, 200, cors);
        }

        case "access_revoke": {
          if (!canManageGrants) {
            return json(
              { error: "This needs the grants.manage permission", code: "no_feature" },
              403,
              cors,
            );
          }
          if (!body.userId) {
            return json({ error: "userId is required", code: "bad_input" }, 400, cors);
          }
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [callerId],
            });
            await conn.queryObject({
              text: "delete from data_center.module_access where user_id = $1",
              args: [body.userId],
            });
            await conn.queryObject("commit");
          } catch (e) {
            await conn.queryObject("rollback");
            throw e;
          }
          return json({ data: { userId: body.userId, revoked: true } }, 200, cors);
        }

        case "change_log": {
          const limit = Math.min(Math.max(body.limit ?? 25, 1), 200);
          const category = typeof body.category === "string" && body.category !== "all"
            ? body.category
            : null;
          if (category && !CHANGE_CATEGORIES.has(category)) {
            return json({ error: `Unknown category: ${category}`, code: "bad_input" }, 400, cors);
          }
          const rows = await conn.queryObject({
            // id cast to text: it is a bigint, which arrives as a JS BigInt
            // and JSON.stringify throws on those.
            //
            // The category is derived here rather than in the UI so there is
            // one definition of which table belongs to which part of the
            // module, and so the filter can run in the database instead of
            // fetching everything and hiding most of it.
            //
            // changed_fields is the difference between the two snapshots the
            // trigger already stores. Without it an update reads as "something
            // changed", which is what made this log unusable.
            text: `with tagged as (
                     select cl.id::text as id, cl.table_name, cl.record_pk, cl.action,
                            cl.changed_at, p.full_name as changed_by_name,
                            ${CHANGE_CATEGORY_SQL} as category,
                            case
                              when cl.action = 'UPDATE' then (
                                select coalesce(array_agg(k order by k), '{}')
                                from jsonb_object_keys(coalesce(cl.new_values, '{}'::jsonb)) k
                                where coalesce(cl.new_values -> k, 'null'::jsonb)
                                      is distinct from coalesce(cl.old_values -> k, 'null'::jsonb)
                                  and k not in ('updated_at', 'updated_by', 'created_at', 'created_by')
                              )
                              else '{}'::text[]
                            end as changed_fields
                     from data_center.change_log cl
                     left join public.profiles p on p.id = cl.changed_by
                   )
                   select * from tagged
                   where $2::text is null or category = $2::text
                   order by changed_at desc
                   limit $1`,
            args: [limit, category],
          });
          return json({ data: rows.rows }, 200, cors);
        }

        /**
         * Everything Settings needs to draw the call form editor, in one read.
         * The lists and the fields are edited together often enough that two
         * round trips would only ever be two round trips.
         */
        case "registry_read": {
          const lists = await conn.queryObject({
            text: `select l.key, l.label, l.description,
                          coalesce(json_agg(json_build_object(
                            'id', v.id::text, 'value', v.value, 'label', v.label,
                            'sort_order', v.sort_order, 'is_active', v.is_active
                          ) order by v.sort_order, v.label)
                            filter (where v.id is not null), '[]') as values
                     from data_center.option_lists l
                     left join data_center.option_values v on v.list_key = l.key
                    group by l.key, l.label, l.description
                    order by l.label`,
          });
          const fields = await conn.queryObject({
            text: `select key, label, section, input_type, option_list_key, storage,
                          column_name, sort_order, is_required, is_active, help_text,
                          visible_when, validation, retired_at
                     from data_center.field_defs
                    order by section, sort_order, label`,
          });
          return json(
            { data: { lists: lists.rows, fields: fields.rows, canEdit: canManageRegistry } },
            200,
            cors,
          );
        }

        /** Add or rename a whole dropdown. */
        case "option_list_upsert": {
          const denied = requireRegistry();
          if (denied) return denied;
          const key = String(body.list?.key ?? "").trim();
          const label = String(body.list?.label ?? "").trim();
          if (!KEY_RE.test(key) || !label) {
            return json(
              {
                error:
                  "A list needs a label and a key of lower-case letters, digits and underscores",
                code: "bad_input",
              },
              400,
              cors,
            );
          }
          await withActor(conn, callerId, async () => {
            await conn.queryObject({
              text: `insert into data_center.option_lists (key, label, description)
                     values ($1, $2, $3)
                     on conflict (key) do update
                       set label = excluded.label, description = excluded.description`,
              args: [key, label, body.list?.description ?? null],
            });
          });
          return json({ data: { key } }, 200, cors);
        }

        /**
         * Add, rename or retire one choice.
         *
         * Retiring sets is_active false rather than deleting: records point at
         * option_values by id, so a delete would either fail on the foreign key
         * or erase what an agent actually chose. A choice stops being offered;
         * it never stops having been picked.
         */
        case "option_value_upsert": {
          const denied = requireRegistry();
          if (denied) return denied;
          const listKey = String(body.value?.listKey ?? "").trim();
          const label = String(body.value?.label ?? "").trim();
          const id = body.value?.id ? String(body.value.id) : null;
          const value = String(body.value?.value ?? "").trim();
          if (!listKey || !label || (!id && !KEY_RE.test(value))) {
            return json(
              {
                error:
                  "A choice needs a label, and a new one needs a value of lower-case letters, digits and underscores",
                code: "bad_input",
              },
              400,
              cors,
            );
          }
          const sortOrder = Number(body.value?.sortOrder ?? 0) || 0;
          const isActive = body.value?.isActive !== false;
          const row = await withActor(conn, callerId, async () => {
            if (id) {
              // The value is the key records already reference, so an edit
              // changes the wording and the ordering and never the key.
              const r = await conn.queryObject<{ id: string }>({
                text: `update data_center.option_values
                          set label = $2, sort_order = $3, is_active = $4
                        where id = $1 returning id::text`,
                args: [id, label, sortOrder, isActive],
              });
              return r.rows[0];
            }
            const r = await conn.queryObject<{ id: string }>({
              text: `insert into data_center.option_values
                       (list_key, value, label, sort_order, is_active)
                     values ($1, $2, $3, $4, $5)
                     on conflict (list_key, value) do update
                       set label = excluded.label, sort_order = excluded.sort_order,
                           is_active = excluded.is_active
                     returning id::text`,
              args: [listKey, value, label, sortOrder, isActive],
            });
            return r.rows[0];
          });
          return json({ data: row ?? {} }, 200, cors);
        }

        /**
         * Add, amend or retire a question on the call form.
         *
         * `storage` is fixed at 'answers' here. Promoting a question to a real
         * column is a migration, because the column has to exist before
         * anything can be written to it, and offering that as a button would
         * be offering a failure. The registry supports the promotion; Settings
         * does not perform it.
         */
        case "field_def_upsert": {
          const denied = requireRegistry();
          if (denied) return denied;
          const f = body.field ?? {};
          const key = String(f.key ?? "").trim();
          const label = String(f.label ?? "").trim();
          const section = String(f.section ?? "").trim();
          const inputType = String(f.inputType ?? "").trim();
          if (!KEY_RE.test(key) || !label || !section || !INPUT_TYPES.has(inputType)) {
            return json(
              {
                error:
                  "A question needs a key of lower-case letters, digits and underscores, a label, a section and a known input type",
                code: "bad_input",
              },
              400,
              cors,
            );
          }
          const optionListKey = f.optionListKey ? String(f.optionListKey) : null;
          if ((inputType === "select" || inputType === "multiselect") && !optionListKey) {
            return json(
              { error: "A dropdown must name the list it draws from", code: "bad_input" },
              400,
              cors,
            );
          }
          await withActor(conn, callerId, async () => {
            await conn.queryObject({
              text: `insert into data_center.field_defs
                       (key, label, section, input_type, option_list_key, storage,
                        sort_order, is_required, is_active, help_text, visible_when, retired_at)
                     values ($1, $2, $3, $4, $5, 'answers', $6, $7, $8, $9, $10::jsonb,
                             case when $8 then null else now() end)
                     on conflict (key) do update
                       set label = excluded.label, section = excluded.section,
                           input_type = excluded.input_type,
                           option_list_key = excluded.option_list_key,
                           sort_order = excluded.sort_order,
                           is_required = excluded.is_required,
                           is_active = excluded.is_active,
                           help_text = excluded.help_text,
                           visible_when = excluded.visible_when,
                           retired_at = case when excluded.is_active then null
                                             else coalesce(field_defs.retired_at, now()) end`,
              args: [
                key, label, section, inputType, optionListKey,
                Number(f.sortOrder ?? 0) || 0,
                f.isRequired === true,
                f.isActive !== false,
                f.helpText ?? null,
                f.visibleWhen ? JSON.stringify(f.visibleWhen) : null,
              ],
            });
          });
          return json({ data: { key } }, 200, cors);
        }

        /** The runtime numbers: batch size, callback limit, staleness, caps. */
        /**
         * Everything the send-back settings screen needs, in one answer.
         *
         * Three lists that are only useful together: who currently receives
         * send-backs, every rep name the ERP has ever written with how much
         * work sits behind it, and the accounts a rep could be linked to.
         * Fetching them separately would mean three round trips to render one
         * screen where every part explains the others.
         */
        case "send_back_config": {
          const refused = requireRouting();
          if (refused) return refused;

          const recipients = await conn.queryObject({
            text: `select r.user_id::text, r.is_enabled, r.note, r.added_at,
                          p.full_name, p.email, p.role,
                          a.full_name as added_by_name
                     from data_center.send_back_recipients r
                     left join public.profiles p on p.id = r.user_id
                     left join public.profiles a on a.id = r.added_by
                    order by p.full_name`,
          });

          /*
           * Every rep the ERP has named, with the weight behind them.
           *
           * The transfer count is the whole reason this screen is worth
           * opening: an unlinked rep with 145 consignments and an unlinked rep
           * with one are the same row without it, and only one of them is
           * worth chasing down an account for.
           */
          const reps = await conn.queryObject({
            text: `with reps as (
                     select lower(trim(h.sales_rep)) as rep_key,
                            min(trim(h.sales_rep))   as rep_name,
                            count(*)::int            as transfers
                       from public.stove_transfer_history h
                      where h.sales_rep is not null and trim(h.sales_rep) <> ''
                      group by lower(trim(h.sales_rep))
                   )
                   select r.rep_key, coalesce(a.rep_name, r.rep_name) as rep_name,
                          r.transfers,
                          a.user_id::text, a.no_account, a.linked_at,
                          p.full_name as account_name, p.email as account_email,
                          /*
                           * The raw ingredients of "can this account actually
                           * open a send-back", resolved in TypeScript below.
                           *
                           * Not decided here: what a level implies lives in
                           * _shared/data-center-roles.ts, and writing that map
                           * into SQL would be a second copy of it - which is
                           * the exact duplication that file exists to end.
                           */
                          p.role as account_app_role,
                          dc.access_role as account_access_role,
                          coalesce(dc.grant_keys, '{}') as account_grant_keys,
                          lb.full_name as linked_by_name,
                          (select count(*)::int from data_center.v_send_backs v
                            where lower(trim(coalesce(v.sales_rep,''))) = r.rep_key)
                            as waiting
                     from reps r
                     left join data_center.sales_rep_accounts a on a.rep_key = r.rep_key
                     left join public.profiles p on p.id = a.user_id
                     left join lateral (
                       select m.access_role,
                              coalesce(array_agg(g.feature_key)
                                       filter (where g.feature_key is not null), '{}') as grant_keys
                         from data_center.module_access m
                         left join data_center.feature_grants g on g.user_id = m.user_id
                        where m.user_id = a.user_id
                        group by m.access_role
                     ) dc on true
                     left join public.profiles lb on lb.id = a.linked_by
                    order by r.transfers desc
                    limit 500`,
          });

          const candidates = await conn.queryObject({
            text: `select id::text, full_name, email, role
                     from public.profiles
                    where full_name is not null and full_name <> ''
                    order by full_name limit 1000`,
          });

          /**
           * Linked is not the same as able to see it.
           *
           * Linking a rep here grants them nothing, deliberately: a routing
           * screen that could hand out module access would be a door into the
           * module that does not look like one. But an administrator who links
           * Femi Isaac and walks away believing he is now notified would be
           * wrong, and until this nothing on screen said so.
           *
           * Resolved through `featuresFor`, the same function every endpoint
           * uses, so a level gaining `corrections.fix` later shows up here
           * without anybody remembering to update a second copy.
           */
          const withAccess = (reps.rows as Record<string, unknown>[]).map((rep) => {
            const appRole = rep.account_app_role as string | null;
            const accessRole = rep.account_access_role as string | null;
            const grantKeys = (rep.account_grant_keys as string[] | null) ?? [];
            const canSee =
              appRole === "super_admin" ||
              featuresFor(accessRole, grantKeys).includes("corrections.fix");
            return { ...rep, account_can_see: Boolean(rep.user_id) && canSee };
          });

          return json(
            {
              data: {
                recipients: recipients.rows,
                reps: withAccess,
                candidates: candidates.rows,
              },
            },
            200,
            cors,
          );
        }

        /**
         * Add somebody to the standing list, or take them off it.
         *
         * `enabled: false` disables rather than deletes, because somebody on
         * leave should stop receiving without anybody having to remember who
         * was on the list before they left. Removal is a separate, explicit
         * act.
         */
        case "send_back_recipient_set": {
          const refused = requireRouting();
          if (refused) return refused;

          const target = String(body.userId ?? "");
          if (!UUID_RE.test(target)) {
            return json({ error: "Which user?", code: "bad_input" }, 400, cors);
          }

          // A standing recipient needs a way in as much as a rep does. The
          // sales_rep level is provisioned when they hold none. Removing the
          // recipient leaves the level: levels are taken away on the Access
          // panel, by a person.
          if (body.enabled === null) {
            await conn.queryObject({
              text: `delete from data_center.send_back_recipients where user_id = $1`,
              args: [target],
            });
            return json({ data: { userId: target, removed: true } }, 200, cors);
          }

          const saved = await conn.queryObject<{ user_id: string; is_enabled: boolean }>({
            text: `insert into data_center.send_back_recipients
                          (user_id, is_enabled, note, added_by)
                   values ($1, coalesce($2, true), $3, $4)
                   on conflict (user_id) do update
                      set is_enabled = coalesce($2, data_center.send_back_recipients.is_enabled),
                          note = coalesce($3, data_center.send_back_recipients.note)
                   returning user_id::text, is_enabled`,
            args: [target, body.enabled ?? null, body.note ?? null, callerId],
          });
          if (saved.rows[0]?.is_enabled) {
            await conn.queryObject({
              text: `insert into data_center.module_access (user_id, access_role, granted_by)
                     values ($1, 'sales_rep', $2)
                     on conflict (user_id) do nothing`,
              args: [target, callerId],
            });
          }
          return json({ data: saved.rows[0] }, 200, cors);
        }

        /**
         * Say which account a rep name means, or that it means nobody.
         *
         * `no_account` is not a failure state. `ACSL Admin`, `Administrator`,
         * `Keffi` and `Gombe` are values the ERP has written into this field
         * that no account will ever correspond to, and marking them is what
         * stops them being re-examined by everybody who opens this screen.
         */
        case "sales_rep_link": {
          const refused = requireRouting();
          if (refused) return refused;

          const repKey = String(body.repKey ?? "").trim().toLowerCase();
          if (!repKey) {
            return json({ error: "Which sales rep?", code: "bad_input" }, 400, cors);
          }
          const target = body.userId ? String(body.userId) : null;
          if (target && !UUID_RE.test(target)) {
            return json({ error: "That is not a user", code: "bad_input" }, 400, cors);
          }
          const noAccount = body.noAccount === true;
          if (target && noAccount) {
            return json(
              {
                error: "A rep is either linked to an account or marked as having none.",
                code: "bad_input",
              },
              400,
              cors,
            );
          }

          /*
           * Linking is also the door. Every linked rep on production held no
           * module_access row, so the corrections page refused the very
           * people the flow routed to. A link now provisions the sales_rep
           * level when the account has none (a level it already holds is
           * never lowered), and an unlink takes that level back only when no
           * other link or recipient flag still justifies it.
           */
          await conn.queryObject("begin");
          try {
            const previous = await conn.queryObject<{ user_id: string | null }>({
              text: `select user_id::text from data_center.sales_rep_accounts where rep_key = $1`,
              args: [repKey],
            });
            const saved = await conn.queryObject({
              // The display name comes from the transfers rather than the
              // caller, so it stays whatever the ERP most recently wrote.
              text: `insert into data_center.sales_rep_accounts
                            (rep_key, rep_name, user_id, no_account, linked_at, linked_by)
                     values ($1,
                             coalesce((select min(trim(h.sales_rep))
                                         from public.stove_transfer_history h
                                        where lower(trim(h.sales_rep)) = $1), $1),
                             $2, $3, now(), $4)
                     on conflict (rep_key) do update
                        set user_id = excluded.user_id,
                            no_account = excluded.no_account,
                            linked_at = now(),
                            linked_by = excluded.linked_by
                     returning rep_key, rep_name, user_id::text, no_account`,
              args: [repKey, target, noAccount, callerId],
            });
            if (target) {
              await conn.queryObject({
                text: `insert into data_center.module_access (user_id, access_role, granted_by)
                       values ($1, 'sales_rep', $2)
                       on conflict (user_id) do nothing`,
                args: [target, callerId],
              });
            }
            // Unlinking takes nothing away. A level is removed on the Access
            // panel, by a person, never as the side effect of a routing edit:
            // the review of slice 1 found the automatic revoke would also
            // delete a sales_rep level a super admin had granted by hand.
            const wasLinked = previous.rows[0]?.user_id ?? null;
            await conn.queryObject("commit");
            return json(
              {
                data: {
                  ...(saved.rows[0] as object),
                  provisioned: Boolean(target),
                  previousUserId: wasLinked,
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
         * The dated rules (slice F3a): which sale field is mandatory from
         * which day. One table in public, read by the sales app's status
         * rule, the module's completeness rule, the dictionary endpoint and
         * the forms. Anyone who may open Settings may read it; changing a
         * date is the registry permission, like rewriting a question.
         */
        case "field_rules_list": {
          const r = await conn.queryObject<Record<string, unknown>>({
            text: `select field_key, table_name, column_name, mandatory_from::text as mandatory_from,
                          applies_to, note, updated_at::text as updated_at, updated_by::text as updated_by
                     from public.sale_field_rules
                    order by mandatory_from, field_key`,
          });
          return json({ data: { rules: r.rows, canEdit: canManageRegistry } }, 200, cors);
        }

        case "field_rule_set": {
          const denied = requireRegistry();
          if (denied) return denied;
          const rule = (body.rule ?? {}) as {
            fieldKey?: unknown; mandatoryFrom?: unknown; appliesTo?: unknown; note?: unknown;
          };
          const fieldKey = String(rule.fieldKey ?? "").trim();
          const field = fieldByKey(fieldKey);
          if (!field) {
            return json({ error: `No such field in the dictionary: ${fieldKey}`, code: "bad_input" }, 400, cors);
          }
          if (field.table !== "sales" && field.table !== "addresses") {
            return json({ error: `${fieldKey} is not a column of the sale or its address, so it cannot carry a rule`, code: "bad_input" }, 400, cors);
          }
          const mandatoryFrom = rule.mandatoryFrom === null ? null : String(rule.mandatoryFrom ?? "").trim();
          if (mandatoryFrom !== null && !/^\d{4}-\d{2}-\d{2}$/.test(mandatoryFrom)) {
            return json(
              { error: "mandatoryFrom is a day, YYYY-MM-DD, or null to lift the rule", code: "bad_input" },
              400,
              cors,
            );
          }
          const appliesTo = Array.isArray(rule.appliesTo) ? rule.appliesTo.map(String) : null;
          if (appliesTo && (appliesTo.length === 0 || appliesTo.some((a) => a !== "sales_app" && a !== "data_center"))) {
            return json({ error: "appliesTo holds sales_app, data_center, or both", code: "bad_input" }, 400, cors);
          }
          const note = rule.note === undefined || rule.note === null ? null : String(rule.note);
          const saved = await withActor(conn, callerId, async () => {
            // A lifted rule keeps its row with no date, so the seed's on conflict
            // do nothing can never bring it back, and the log keeps who lifted it.
            const r = await conn.queryObject<{ field_key: string; mandatory_from: string | null }>({
              text: `insert into public.sale_field_rules
                       (field_key, table_name, column_name, mandatory_from, applies_to, note, updated_by)
                     values ($1, $2, $3, $4::date, coalesce($5::text[], array['sales_app', 'data_center']), $6, $7::uuid)
                     on conflict (field_key) do update
                        set mandatory_from = excluded.mandatory_from,
                            applies_to = coalesce($5::text[], public.sale_field_rules.applies_to),
                            note = coalesce($6, public.sale_field_rules.note),
                            updated_by = excluded.updated_by
                     returning field_key, mandatory_from::text as mandatory_from`,
              args: [fieldKey, field.table, field.column, mandatoryFrom, appliesTo, note, callerId],
            });
            return r.rows[0];
          });
          return json({ data: saved }, 200, cors);
        }

        case "config_read": {
          const rows = await conn.queryObject({
            text: `select key, value, description
                     from data_center.workflow_config order by key`,
          });
          return json({ data: { config: rows.rows, canEdit: canManageRegistry } }, 200, cors);
        }

        case "config_set": {
          const denied = requireRegistry();
          if (denied) return denied;
          const key = String(body.config?.key ?? "").trim();
          if (!key) {
            return json({ error: "key is required", code: "bad_input" }, 400, cors);
          }
          // Only an existing setting can be changed. A new key would be a
          // setting nothing reads, which looks like it took effect.
          const updated = await withActor(conn, callerId, async () => {
            const r = await conn.queryObject<{ key: string }>({
              text: `update data_center.workflow_config
                        set value = $2::jsonb
                      where key = $1 returning key`,
              args: [key, JSON.stringify(body.config?.value ?? null)],
            });
            return r.rows[0];
          });
          if (!updated) {
            return json({ error: `No such setting: ${key}`, code: "bad_input" }, 400, cors);
          }
          return json({ data: { key } }, 200, cors);
        }

        /**
         * Tier-2 features, per user, on top of whatever their level already
         * grants. The level is the baseline; a tick here is an addition, which
         * is how someone who is not a super admin comes to see Settings at all.
         */
        case "feature_grants_list": {
          if (!canManageGrants) {
            return json(
              { error: "This needs the grants.manage permission", code: "no_feature" },
              403,
              cors,
            );
          }
          const rows = await conn.queryObject({
            text: `select user_id::text, feature_key from data_center.feature_grants
                    order by user_id, feature_key`,
          });
          return json({ data: rows.rows }, 200, cors);
        }

        case "feature_grant_set": {
          /**
           * Withholding grants.manage from the data manager level meant
           * nothing while this action was ungated: a data manager could tick
           * grants.manage onto themselves and become an access administrator
           * in one request. A level that can grant itself more is not a level,
           * which is the exact sentence the role table already carried and
           * this endpoint quietly contradicted.
           */
          if (!canManageGrants) {
            return json(
              { error: "This needs the grants.manage permission", code: "no_feature" },
              403,
              cors,
            );
          }
          const userId = body.userId ? String(body.userId) : "";
          const featureKey = String(body.featureKey ?? "").trim();
          if (!userId || !featureKey) {
            return json(
              { error: "userId and featureKey are required", code: "bad_input" },
              400,
              cors,
            );
          }
          await withActor(conn, callerId, async () => {
            if (body.granted) {
              await conn.queryObject({
                text: `insert into data_center.feature_grants (user_id, feature_key, granted_by)
                       values ($1, $2, $3)
                       on conflict (user_id, feature_key) do nothing`,
                args: [userId, featureKey, callerId],
              });
            } else {
              await conn.queryObject({
                text: `delete from data_center.feature_grants
                        where user_id = $1 and feature_key = $2`,
                args: [userId, featureKey],
              });
            }
          });
          return json({ data: { userId, featureKey, granted: body.granted === true } }, 200, cors);
        }

        default:
          return json(
            { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
            400,
            cors,
          );
      }
    });
  } catch (err) {
    console.error("[data-center-admin]", err);
    return json({ error: "Data Center request failed", code: "internal" }, 500, cors);
  }
});

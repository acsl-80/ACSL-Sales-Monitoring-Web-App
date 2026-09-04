// Data Center: the computation.
//
// This is the only thing in the module that reads every sale. It is allowed to
// be slow, because nobody is waiting on it: it writes into metric_snapshots and
// the dashboard reads from there.
//
// THE SPLIT THIS FUNCTION EXISTS TO ENFORCE
//
//   compute   aggregates public.sales, on a schedule or on demand, never on
//             page load. Measured at 500,000 sales: 74 metrics in 5.2 seconds.
//   read      serves the dashboard from snapshots only. Same measurement: a
//             dashboard load is 2.3 ms, and it stays 2.3 ms whether the
//             database holds 38 rows or 500,000, because it does not touch
//             sales at all.
//
// The rule someone can check by reading: if a query behind a dashboard contains
// count(*), sum() or group by over public.sales, it belongs here and not there.
//
// WHY THE WORK IS IN SQL AND NOT HERE
//
// data_center.compute_metrics() does all of it. This function creates the run,
// calls that, and records what happened. Twenty aggregate queries issued from
// TypeScript would be twenty round trips against an edge function's wall clock,
// and "where does that number come from" would have twenty answers instead of
// one file.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection } from "../_shared/data-center-db.ts";
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
      .from("profiles").select("role").eq("id", userId).single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }
    const superAdmin = profile.role === "super_admin";

    let body: { action?: string; families?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    switch (body.action) {
      /**
       * When was this last computed, and did it work?
       *
       * Open to anyone who may see a dashboard, because "these numbers are from
       * yesterday" is part of reading them honestly.
       */
      case "status": {
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            text: `select id::text, started_at, finished_at, status,
                          metrics_written, duration_ms, error
                   from data_center.metric_runs
                   order by started_at desc limit 5`,
          });
          return json({ data: { runs: r.rows } }, 200, cors);
        });
      }

      /**
       * Compute now.
       *
       * Restricted to super admin. It is the heaviest thing in the module and
       * it is normally scheduled, so an on-demand run is an administrative act
       * rather than a button anyone gets.
       */
      case "run": {
        // A run of named families only: today the pool family, which the
        // board's Recompute presses. The full run reads every sale and stays
        // a super admin's act; the pool run belongs to whoever may hand out
        // work, because it is their board.
        const families = Array.isArray(body.families) && body.families.length > 0
          ? body.families.map(String)
          : null;
        if (!superAdmin) {
          const poolOnly = families !== null && families.every((f) => f === "pool");
          const allowed = poolOnly && (await withReadConnection(async (conn) => {
            const r = await conn.queryObject<{ access_role: string; keys: string[] }>({
              text: `select m.access_role,
                            coalesce(array_agg(g.feature_key) filter (where g.feature_key is not null), '{}') as keys
                       from data_center.module_access m
                       left join data_center.feature_grants g on g.user_id = m.user_id
                      where m.user_id = $1
                      group by m.access_role`,
              args: [userId],
            });
            const row = r.rows[0];
            return row ? featuresFor(row.access_role, row.keys).includes("assignment.manage") : false;
          }));
          if (!allowed) {
            return json({ error: "Only a super admin can run the computation", code: "forbidden" }, 403, cors);
          }
        }

        // One run at a time, enforced by an advisory lock rather than by
        // looking for a row that says `running`.
        //
        // The obvious version reads metric_runs for a running row and inserts
        // one if it finds none, which is check-then-act: two requests can both
        // read "none" before either writes. Tested, and both got through.
        //
        // pg_try_advisory_lock cannot be raced. It is a session lock held on
        // this one connection, so it is released when the request ends even if
        // the function crashes mid-run. That is also why the whole run happens
        // on a single connection rather than one per step.
        const LOCK_KEY = 8_150_620; // arbitrary, but must stay stable

        const started = Date.now();
        const result = await withConnection(async (conn) => {
          const lock = await conn.queryObject<{ locked: boolean }>({
            text: "select pg_try_advisory_lock($1) as locked",
            args: [LOCK_KEY],
          });
          if (!lock.rows[0]?.locked) return { busy: true as const };

          const run = await conn.queryObject<{ id: string }>({
            text: "insert into data_center.metric_runs (triggered_by) values ($1) returning id::text",
            args: [userId],
          });
          const runId = run.rows[0].id;

          try {
            const r = await conn.queryObject<{ compute_metrics: number }>({
              text: "select data_center.compute_metrics($1, $2) as compute_metrics",
              args: [runId, families],
            });
            const written = Number(r.rows[0]?.compute_metrics ?? 0);

            // A partial run stops at the family it asked for; the funnel, the
            // scorecards and the analysis are the full run's.
            let scorecardRows = 0;
            let analysisRows = 0;
            if (families === null) {
              // The reconciliation funnel is computed too, so it refreshes here:
              // same connection, same advisory lock, same "as of" moment. A
              // dashboard and a Partner Records page that disagree about how
              // current they are would be worse than either being stale.
              await conn.queryObject("select data_center.refresh_transfer_funnel()");

              // The scorecards read the funnel just refreshed, which is why the
              // order matters: funnel first, then the sums over it. Same run id,
              // so the dashboard swaps to the new set atomically with the rest.
              const sc = await conn.queryObject<{ n: number }>({
                text: "select data_center.compute_scorecards($1) as n",
                args: [runId],
              });
              scorecardRows = Number(sc.rows[0]?.n ?? 0);

              // Analysis last, in the same run and under the same lock. It reads
              // sales and stock directly rather than the funnel, so it does not
              // depend on the step above - but it must share the run id, or the
              // Analysis page and the Dashboard would be able to disagree about
              // which afternoon they are describing.
              const an = await conn.queryObject<{ n: number }>({
                text: "select data_center.compute_analysis($1) as n",
                args: [runId],
              });
              analysisRows = Number(an.rows[0]?.n ?? 0);
            }

            const duration = Date.now() - started;
            await conn.queryObject({
              text: `update data_center.metric_runs
                     set status = 'ok', finished_at = now(),
                         metrics_written = $2, duration_ms = $3
                     where id = $1`,
              args: [runId, written + scorecardRows + analysisRows, duration],
            });
            return { busy: false as const, runId, written: written + scorecardRows + analysisRows, duration };
          } catch (err) {
            // A failed run is recorded as failed rather than left `running`.
            // v_current_metrics only ever reads a run whose status is ok, so a
            // half-written set can never become what the dashboard shows.
            const message = err instanceof Error ? err.message : "Computation failed";
            await conn.queryObject({
              text: `update data_center.metric_runs
                     set status = 'failed', finished_at = now(), error = $2
                     where id = $1`,
              args: [runId, message.slice(0, 500)],
            });
            throw err;
          } finally {
            await conn.queryObject({
              text: "select pg_advisory_unlock($1)",
              args: [LOCK_KEY],
            }).catch(() => {});
          }
        });

        if (result.busy) {
          return json(
            { error: "A computation is already running. Wait for it to finish.", code: "already_running" },
            409,
            cors,
          );
        }

        return json(
          { data: { runId: result.runId, metricsWritten: result.written, durationMs: result.duration } },
          200,
          cors,
        );
      }

      /** Housekeeping. The two newest successful runs are never removed. */
      case "prune": {
        if (!superAdmin) {
          return json({ error: "Only a super admin can prune", code: "forbidden" }, 403, cors);
        }
        return await withConnection(async (conn) => {
          const r = await conn.queryObject<{ prune_metric_runs: number }>({
            text: "select data_center.prune_metric_runs($1) as prune_metric_runs",
            args: [Number((body as { keepDays?: number }).keepDays ?? 90)],
          });
          return json({ data: { removed: Number(r.rows[0]?.prune_metric_runs ?? 0) } }, 200, cors);
        });
      }

      default:
        return json(
          { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
          400,
          cors,
        );
    }
  } catch (err) {
    console.error("[data-center-compute]", err);
    return json({ error: "Data Center computation failed", code: "internal" }, 500, resolveCors(req));
  }
});

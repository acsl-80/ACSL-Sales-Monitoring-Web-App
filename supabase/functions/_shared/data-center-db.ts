/**
 * Postgres access for the Data Center's edge functions.
 *
 * Namespaced `data-center-` because it lives in the shared folder but belongs
 * to one module. Nothing in the sales app imports it, and adding it changed no
 * existing behaviour.
 *
 * WHY THIS EXISTS
 *
 * `data_center` is deliberately absent from PostgREST's exposed schemas, so
 * these functions open their own Postgres connections rather than going through
 * supabase-js. That omission is the module's isolation guarantee, and this file
 * is the cost of it.
 *
 * WHY IT DOES NOT POOL
 *
 * It used to. A module-level pool is the obvious shape, and in a long-lived
 * server it is the right one. In an edge function it is a slow leak, and the
 * failure it causes is far worse than the latency it saves.
 *
 * Measured against the preview branch, running the pattern of one Data Center
 * page load every 1.5 seconds:
 *
 *   round 0   4 requests ok    postgres connections 59, of which deno holds 42
 *   round 1   4 requests ok    61 / 44
 *   round 2   4 requests ok    65 / 47      <- past max_connections, which is 60
 *   round 3   1 of 4 failed
 *   round 4   3 of 4 failed    the management API could not connect either
 *
 * The cause is that Supabase runs many isolates per function, each keeps its
 * own module-level pool, and a pooled connection is never closed while the
 * isolate lives. Three Data Center functions across a handful of isolates is
 * enough to exhaust the database.
 *
 * The consequence is not confined to this module. Postgres refuses everyone at
 * that point, including the PostgREST instance the sales app depends on. A
 * module whose entire premise is that the sales app must not notice it exists
 * cannot be the thing that takes the database down.
 *
 * So: one connection per request, closed when the request ends. The number of
 * connections in flight can never exceed the number of requests in flight.
 *
 * WHAT THAT COSTS, MEASURED RATHER THAN GUESSED
 *
 * An earlier version of this comment estimated "roughly 20 to 50 ms". That was
 * wrong and is corrected here. Against the preview branch, a request that runs
 * one statement answers in about 650 ms and one that runs three took about
 * three seconds, on data small enough that every query is sub-millisecond. The
 * cost is the connection and the round trips, not the work.
 *
 * Two things follow, and both are acted on elsewhere in the module:
 *
 *   Statements per request is the number worth minimising. The dashboard read
 *   was three statements and is now one, which took it from ~3 s to ~1.8 s.
 *
 *   These are not production numbers. The preview branch is a small instance,
 *   and the same dashboard read against a LOCAL database holding 500,000 sales
 *   answers in 250 ms. A branch holding five sales being slower than a local
 *   database holding half a million is the clearest evidence that this latency
 *   is infrastructure and not data volume.
 *
 * THE POOLER WAS TRIED AND MADE IT WORSE
 *
 * Supabase's pgbouncer (transaction mode, port 6543) is the textbook answer for
 * a serverless client, and DATA_CENTER_DB_URL exists so it can be adopted by
 * setting one secret. Pointed at it, the same requests went from ~2 s to ~3.2 s,
 * because the pooler host sits in a different region from the project. Left in
 * place as a hook rather than a recommendation: measure before adopting it, on
 * the project it will actually run against.
 *
 * What is NOT the answer is pooling inside the isolate. That is what took the
 * database down.
 */

import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

type Conn = Client;

/**
 * The pooler's URL, built from the direct one so no password is ever configured.
 *
 * `SUPABASE_DB_URL` is injected into every function and already carries the
 * credentials. The pooler wants the same password with a different host, port
 * and user, so the switch is a hostname rather than a second connection string
 * with a copy of the password in it. A hostname is not a secret and cannot go
 * stale against a password rotation.
 *
 *   postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres
 *   postgresql://postgres.<ref>:PW@<pooler host>:6543/postgres
 */
function poolerUrlFrom(direct: string, host: string): string {
  const u = new URL(direct);
  if (!/^db\..+\.supabase\.co$/.test(u.hostname) || !u.password) {
    // Not the shape this derivation knows how to read. Say so rather than
    // guess: a wrong URL here would fail at connect time with an error about
    // a user nobody configured, which is a bad way to learn this.
    throw new Error(
      `Cannot derive a pooler URL from a database host of "${u.hostname}"; set DATA_CENTER_DB_URL explicitly instead`,
    );
  }
  const ref = u.hostname.replace(/^db\./, "").replace(/\.supabase\.co$/, "");
  const password = decodeURIComponent(u.password);
  // The database and any options come from the URL rather than being assumed,
  // so pointing this at a non-default database keeps working.
  const database = u.pathname && u.pathname !== "/" ? u.pathname : "/postgres";
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543${database}${u.search}`;
}

function connectionString(mode: "pooled" | "direct" = "pooled"): string {
  const direct = Deno.env.get("SUPABASE_DB_URL");
  if (mode === "direct") {
    if (!direct) throw new Error("SUPABASE_DB_URL is not configured");
    return direct;
  }
  // An explicit URL still wins, so anything can be pointed anywhere by hand.
  const explicit = Deno.env.get("DATA_CENTER_DB_URL");
  if (explicit) return explicit;
  // Otherwise the pooler, if a host has been named for it.
  const poolerHost = Deno.env.get("DATA_CENTER_POOLER_HOST");
  if (poolerHost && direct) return poolerUrlFrom(direct, poolerHost);
  if (!direct) throw new Error("Neither DATA_CENTER_DB_URL nor SUPABASE_DB_URL is configured");
  return direct;
}

/**
 * Run work against Postgres on a connection that belongs to this request alone.
 *
 * The `end()` is in a finally and is itself guarded: a connection that already
 * died cannot be closed politely, and throwing from the cleanup would replace
 * the real error with a confusing one.
 */
export async function withConnection<T>(work: (conn: Conn) => Promise<T>): Promise<T> {
  const client = new Client(connectionString());
  await client.connect();
  try {
    return await work(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* already gone; nothing left to close */
    }
  }
}

/**
 * The same, with one retry.
 *
 * Only for work that is safe to run twice, which in practice means reads. A
 * write that may have half-applied is a different problem with a different
 * answer, so the write endpoint uses `withConnection` directly.
 */
export async function withReadConnection<T>(work: (conn: Conn) => Promise<T>): Promise<T> {
  try {
    return await withConnection(work);
  } catch (err) {
    console.warn("[data-center] retrying a read on a new connection", err);
    return await withConnection(work);
  }
}

/**
 * For the write path, which holds one connection across a multi-statement
 * transaction and so cannot use the callback form. Same policy: one connection
 * per request, closed when the request ends.
 */
export async function openConnection(): Promise<Conn> {
  const client = new Client(connectionString());
  await client.connect();
  return client;
}

/**
 * A connection to the database itself, never through a pooler.
 *
 * For work that needs the session to survive between statements. Transaction
 * pooling gives one server connection per transaction, not per session, so a
 * SESSION-level advisory lock taken in one statement is not guaranteed to be
 * held by the next. The computation takes exactly such a lock to make itself
 * unrunnable twice at once, and it is the only thing in the module that does;
 * everything else uses `pg_try_advisory_xact_lock` and `set_config(..., true)`,
 * which are transaction-scoped and pool safely.
 *
 * Measured through the pooler on 2026-09-16, a session lock taken and released
 * in two statements did succeed. That is not proof: it means both statements
 * happened to land on the same server connection. This exists so the
 * computation never has to rely on that.
 *
 * An explicit `DATA_CENTER_DB_URL` is ignored here on purpose. That override
 * exists to route the module through a pooler, and this is the one path that
 * must not be routed through one. If it is ever repurposed to point the module
 * at a different database, this function needs revisiting with it.
 */
export async function withDirectConnection<T>(work: (conn: Conn) => Promise<T>): Promise<T> {
  const client = new Client(connectionString("direct"));
  await client.connect();
  try {
    return await work(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* already gone; nothing left to close */
    }
  }
}

export async function closeConnection(conn: Conn | null): Promise<void> {
  if (!conn) return;
  try {
    await conn.end();
  } catch {
    /* already gone; nothing left to close */
  }
}

export type { Conn as PoolClient };

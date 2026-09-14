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

function connectionString(): string {
  // Prefer an explicitly configured URL, so the pooler can be adopted by
  // setting one secret rather than by changing code.
  const url = Deno.env.get("DATA_CENTER_DB_URL") ?? Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("Neither DATA_CENTER_DB_URL nor SUPABASE_DB_URL is configured");
  return url;
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

export async function closeConnection(conn: Conn | null): Promise<void> {
  if (!conn) return;
  try {
    await conn.end();
  } catch {
    /* already gone; nothing left to close */
  }
}

export type { Conn as PoolClient };

// The parts of a self-continuing import commit that have one right answer.
//
// WHY THESE FOUR AND NOTHING ELSE
//
// The receipt commit is not a generic engine with receipt details bolted on.
// It is a receipt engine whose concurrency SHAPE is generic. The parts that
// differ between two imports are not incidental: the claim key is the lock and
// it is a stove serial (see `import_claims`, whose own comment says so), the
// stock lateral runs inside the lease transaction, and orphan adoption and the
// shared-phone register run inside the outcome transaction. Lifting the whole
// thing would mean seven to nine strategy callbacks, three of them returning
// SQL fragments, and a migration against a live table.
//
// So this module holds only what a second import would otherwise have to guess
// at and get wrong. Each of these has exactly one correct implementation, the
// way `data-center-dates.ts` has one answer to "what year is 46217":
//
//   the lease      - a timestamp CAS, because this module opens a connection
//                    per statement and an advisory lock dies with its
//                    connection. It could guard a few milliseconds of claiming
//                    but not the minutes of writing that follow.
//   the next link  - awaited to its response, because a fire-and-forgotten
//                    fetch can be dropped at worker teardown, and a dropped
//                    link is a chain that silently stops. This one cost a
//                    debugging session to learn.
//   the breaker    - three passes with no outcome stops the chain, so a wedged
//                    batch cannot spin against the 2500-link cap.
//
// Everything else about a commit stays in the function that owns it.

import type { PoolClient } from "./data-center-db.ts";

/** How long a link holds the batch before another may take it. */
const LEASE_MINUTES = 7;

/** Consecutive links achieving nothing before the chain gives up. */
export const ZERO_RUN_LIMIT = 3;

export const BREAKER_MESSAGE =
  "Commit paused: three passes in a row made no progress. Press Commit to try again.";

/**
 * Take the batch's commit lease, or report that somebody else holds it.
 *
 * Runs inside the caller's transaction, and must be its FIRST statement: the
 * whole point is that "two rapid presses, the second answers busy" is a fact
 * rather than a race, which only holds if the CAS happens before any of the
 * slow work and before the response.
 *
 * The `state` predicate is doing a second job. It refuses a batch that
 * rollback has already moved on, which is the other half of the fence rollback
 * puts up when it refuses a batch under a live lease.
 */
export async function takeCommitLease(
  conn: PoolClient,
  batchId: string,
  states: string[] = ["staged", "validated", "dry_run"],
  sources: string[] | null = null,
): Promise<boolean> {
  const held = await conn.queryObject<{ id: string }>({
    text: `update data_center.import_batches
              set commit_lease_until = now() + interval '${LEASE_MINUTES} minutes'
            where id = $1
              and state = any($2::text[])
              and ($3::text[] is null or source = any($3::text[]))
              and (commit_lease_until is null or commit_lease_until < now())
            returning id`,
    args: [batchId, states, sources],
  });
  return held.rows.length > 0;
}

/**
 * Release the lease.
 *
 * Called on the way out of a link, on the chain caps, and from the catch that
 * wraps the slice - a thrown slice must not leave the batch wedged, because
 * the stall CTA can only offer Continue to a batch nobody is holding.
 */
export async function clearCommitLease(
  conn: PoolClient,
  batchId: string,
): Promise<void> {
  await conn.queryObject({
    text:
      `update data_center.import_batches set commit_lease_until = null where id = $1`,
    args: [batchId],
  });
}

/**
 * Should the chain stop because it is achieving nothing?
 *
 * `outcomes` is rows committed plus rows excepted. A link that produced
 * neither, three times running, is not slow - it is stuck, and the 2500-link
 * cap is far too generous to catch it. The count rides in the request body
 * rather than a column so a fresh press resets it naturally.
 */
export function breakerFor(
  outcomes: number,
  zeroRuns: number,
  left: number,
): { nextZeroRuns: number; breaker: boolean } {
  const nextZeroRuns = outcomes === 0 ? zeroRuns + 1 : 0;
  return { nextZeroRuns, breaker: left > 0 && nextZeroRuns >= ZERO_RUN_LIMIT };
}

/**
 * Fire the next link of the chain, and wait for it to answer.
 *
 * The await is load-bearing and is the reason this function exists rather than
 * being written out at each call site. A fire-and-forgotten fetch can be
 * dropped when the worker tears down, and a dropped link is a chain that
 * silently stops with rows still to write. Waiting for the 202 costs nothing
 * because the next link answers before it does any work of its own.
 *
 * The caller's own Authorization header rides along so the writes stay
 * attributed to the person who pressed Commit, and so org scoping is enforced
 * by the same code their first request went through.
 *
 * A failure here is swallowed on purpose: the lease is already cleared by the
 * time this runs, so the batch is resumable and the panel's stall detection
 * offers Continue. Throwing would only turn a resumable pause into a wedged
 * batch.
 */
export async function chainNext(args: {
  slug: string;
  action: string;
  batchId: string;
  link: number;
  zeroRuns: number;
  authHeader: string | null;
}): Promise<void> {
  try {
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/${args.slug}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: args.authHeader ?? "",
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify({
          action: args.action,
          batchId: args.batchId,
          link: args.link + 1,
          zeroRuns: args.zeroRuns,
        }),
      },
    );
    await res.text();
  } catch {
    // Deliberately silent. See the doc comment above.
  }
}

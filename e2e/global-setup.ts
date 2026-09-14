import { chromium, type FullConfig } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Give the module's boards the state they read, before any spec reads it.
 *
 * The Data Center does not compute on the fly. Its dashboard, scorecards and
 * analysis boards all read rows written by a computation run, and the call
 * centre pages read batches written by the assignment engine. Neither happens
 * on its own, and no spec asks for either.
 *
 * That went unnoticed for as long as the suite ran against one long-lived
 * preview database, which already held both from whoever had run last. Per-PR
 * Supabase branching now builds a database from scratch for every PR, and on
 * one of those the order stops being kind: Playwright takes files
 * alphabetically on a single worker, so `data-center-analysis` and
 * `data-center-assignment` both run before anything that would have populated
 * what they read. Both failed on exactly that, and the compute run on the
 * branch database was stamped one minute before a thirty-minute suite ended.
 *
 * Doing it here rather than inside a spec keeps the dependency in one place.
 * A spec that quietly relies on another spec having run first is the problem
 * this exists to remove, not a pattern worth copying into two more files.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ?? process.env.PREVIEW_URL;

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    // A super admin, because the computation refuses anyone else. This reuses
    // the suite's own sign-in rather than authenticating a second way, so the
    // setup breaks in the same place the tests would if login itself broke.
    await signIn(page, USERS.admin);

    /*
     * The engine first, the computation second. The order is the whole point.
     *
     * Two of the five scorecards are computed FROM assignment data: the call
     * agent cut off `assignment_batches.assigned_to`, the manager cut off the
     * agent's `manager_id`. Computing before assigning leaves both empty, so a
     * fresh database renders three scorecards where the dashboard promises
     * five, and the specs that check all five carry the same columns fail on
     * a page that is not actually wrong.
     *
     * This file shipped with the order reversed and did exactly that. It hid
     * on a warm database, where yesterday's batches were already there to be
     * counted, which is the same way the dependency this file removes stayed
     * hidden for months.
     */
    const assign = await callEdgeFunction(page, "data-center-assign", { action: "run" });
    if (assign.status !== 200) {
      throw new Error(
        `global setup could not run the assignment engine: ${assign.status} ` +
          JSON.stringify(assign.body),
      );
    }
    const batches =
      (assign.body as { data?: { batches?: unknown[] } })?.data?.batches?.length ?? 0;

    const compute = await callEdgeFunction(page, "data-center-compute", { action: "run" });
    /*
     * 409 means a run is already in flight, held off by the advisory lock. That
     * is fine, since the point is that a run exists rather than that this one
     * made it. Anything else is fatal: passing quietly here would put the suite
     * back to depending on state nobody creates, which is what this file is for.
     */
    if (compute.status !== 200 && compute.status !== 409) {
      throw new Error(
        `global setup could not run the computation: ${compute.status} ` +
          JSON.stringify(compute.body),
      );
    }
    const written =
      (compute.body as { data?: { metricsWritten?: number } })?.data?.metricsWritten;

    console.log(
      `global setup   : ${batches} batch(es) assigned, ${
        compute.status === 409 ? "computation already running" : `${written ?? 0} metrics written`
      }
`,
    );
  } finally {
    await browser.close();
  }
}

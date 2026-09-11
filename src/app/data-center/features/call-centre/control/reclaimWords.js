import { plural } from "../../../lib/plural";

/**
 * What Reclaim did, in words (Phase 28, D50). Since slice 5 a quiet batch
 * lets go of its untried numbers and keeps the worked ones with the agent,
 * so the notice counts records released and kept, then batches closed
 * because nothing was left in them. Read by the board and the decisions card.
 */
export const reclaimWords = (out) =>
  out.released || out.reclaimed
    ? `${plural(out.released, "untried number")} went back to the pool; ${plural(out.kept, "worked record")} stayed with the agents; ${plural(out.reclaimed, "batch", "batches")} closed.`
    : out.kept
      ? `Nothing went back: the ${plural(out.kept, "record")} in quiet batches ${out.kept === 1 ? "has" : "have"} all been worked and stay with their agents.`
      : "Nothing to release: every open batch has recent activity.";

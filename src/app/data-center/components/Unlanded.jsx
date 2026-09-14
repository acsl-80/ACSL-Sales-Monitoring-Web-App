import { AlertTriangle } from "lucide-react";
import { dataCenterImport } from "../lib/client";

/**
 * What did not land, grouped by why.
 *
 * WHY THIS EXISTS
 *
 * Both imports had the reasons in hand and threw them away. The receipt import
 * said "Commit finished." over any number of rows that did not finish. The call
 * import was worse: a green box reading "12 rows did not go through and kept
 * its reason", which tells somebody a reason exists without showing it, in the
 * colour used for success.
 *
 * A count of successes is not a result. The result is what happened to every
 * row, and the rows that did not go in are the only ones anybody has to act on.
 *
 * GROUPED, NOT LISTED
 *
 * Four hundred reasons is not a report. Almost always a failed import fails in
 * two or three shapes - the same partner mismatch forty times, the same
 * duplicate serial twelve times - so the shape comes first and the row numbers
 * second. The row numbers matter because the person fixing it is looking at a
 * spreadsheet where rows are numbered.
 */

/**
 * Read a batch's unlanded rows back and group them.
 *
 * Read from the batch rather than from the commit response, because a row can
 * fail at two different moments - being checked, and being written - and
 * whoever is reading does not care which. One list, whatever stopped it.
 */
export async function groupUnlanded(batchId) {
  try {
    const rows = await dataCenterImport.rows(batchId, "exception");
    const byReason = new Map();
    for (const r of rows ?? []) {
      const why = r.exception_reason ?? r.rejection_reason ?? "No reason recorded";
      const at = byReason.get(why) ?? [];
      at.push(r.row_number);
      byReason.set(why, at);
    }
    return [...byReason.entries()]
      .map(([reason, rowNumbers]) => ({ reason, rows: rowNumbers.sort((a, b) => a - b) }))
      .sort((a, b) => b.rows.length - a.rows.length);
  } catch {
    // A failure to explain a failure is not worth a second error on screen.
    return [];
  }
}

/**
 * `phase` is not decoration.
 *
 * The same list is shown at two moments and they are not the same statement.
 * After a commit, "did not go in" is a fact. Before one, nothing has gone in
 * yet and saying it had is simply false: those rows WILL not go in, and the
 * rest still can, which is the thing the reader has to decide about. Getting
 * this wrong tells somebody their import already half failed when they have not
 * pressed anything.
 */
export default function Unlanded({ groups, noun = "row", phase = "committed" }) {
  if (!groups?.length) return null;
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const many = total !== 1;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
      <p className="flex items-start gap-2 text-sm font-medium text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        {phase === "staged"
          ? `${total} ${many ? `${noun}s` : noun} cannot be written as ${many ? "they" : "it"} stand${many ? "" : "s"}. Everything else can still be committed.`
          : `${total} ${many ? `${noun}s did` : `${noun} did`} not go in. Nothing else was affected.`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {groups.map((g) => (
          <li key={g.reason} className="text-sm text-amber-900">
            <span className="font-medium tabular-nums">{g.rows.length}</span>{" "}
            {g.rows.length === 1 ? noun : `${noun}s`}: {g.reason}
            <span className="block text-xs text-amber-800">
              {g.rows.length > 6
                ? `rows ${g.rows.slice(0, 6).join(", ")} and ${g.rows.length - 6} more`
                : `row${g.rows.length === 1 ? "" : "s"} ${g.rows.join(", ")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

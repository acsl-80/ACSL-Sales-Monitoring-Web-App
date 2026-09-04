import Link from "@/compat/Link";
import { metricValue } from "../../../lib/metricValue";
import { plural } from "../../../lib/plural";
import { ArrowRight } from "lucide-react";

/**
 * The lanes beside the pool: work that came back, and work that is due again.
 *
 * Send-backs read from `work_waiting`, the same numbers the banner shows, so
 * the two never disagree. Recalls due comes from the pool family; stove IDs
 * unconfirmed from `work_waiting`. Each line is a link to the list or the
 * preset that holds those records.
 */

function Lane({ count, title, sub, href, label }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-12 shrink-0 text-2xl font-semibold tabular-nums text-gray-900">{count.toLocaleString()}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-600">{sub}</p>
      </div>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
      >
        {label} <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function SendBacksLane({ waiting, metrics }) {
  const m = metrics?.metrics ?? [];
  const open = waiting?.openAll ?? metricValue(m, "corrections.open");
  const fixed = waiting?.fixedAll ?? metricValue(m, "corrections.fixed");
  const unrouted = waiting?.unroutedReps ?? 0;
  return (
    <section data-lane="send-backs" className="divide-y divide-gray-100 rounded-xl border border-gray-200 border-t-[3px] border-t-red-600 bg-white shadow-sm">
      <Lane
        count={open}
        title="Waiting on Sales"
        sub={unrouted > 0 ? `${plural(unrouted, "rep")} with no account; the standing recipients carry theirs` : "sent back, not in the pool until fixed"}
        href="/data-center/corrections?tab=open"
        label="Open corrections"
      />
      <Lane
        count={fixed}
        title="Awaiting review"
        sub="fixed by Sales; close each one to ring again"
        href="/data-center/corrections?tab=fixed"
        label="Review"
      />
    </section>
  );
}

export function RecallsLane({ waiting, metrics }) {
  const m = metrics?.metrics ?? [];
  return (
    <section data-lane="recalls" className="divide-y divide-gray-100 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <Lane
        count={metricValue(m, "pool.recall_due")}
        title="Recalls due"
        sub="closed corrections newer than the last call"
        href="/data-center/call-centre?preset=recall_due"
        label="Show in queue"
      />
      <Lane
        count={waiting?.unconfirmed ?? 0}
        title="Stove IDs unconfirmed"
        sub="another caller's rematch took the stove these records named"
        href="/data-center/call-centre?preset=unconfirmed"
        label="Show in queue"
      />
    </section>
  );
}

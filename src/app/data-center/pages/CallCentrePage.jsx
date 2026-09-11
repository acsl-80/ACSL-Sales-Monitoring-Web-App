import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import Link from "@/compat/Link";
import MyWork from "../features/call-centre/MyWork";
import DayChips from "../features/call-centre/control/DayChips";
import Figures from "../features/call-centre/control/Figures";
import ShiftBoard from "../features/call-centre/control/ShiftBoard";
import WaitingByPartner from "../features/call-centre/control/WaitingByPartner";
import NeedsDecision from "../features/call-centre/control/NeedsDecision";
import HappenedToday from "../features/call-centre/control/HappenedToday";
import { useControlCentre } from "../features/call-centre/control/useControlCentre";
import { useAgentsMeta } from "../features/call-centre/control/useAgentsMeta";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { callCentreLayout } from "../lib/callCentreLayout";

function dayWords(board) {
  if (!board) return "today";
  if (board.range === "week") return "this week";
  if (board.range === "month") return `in ${new Date(`${board.day}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  if (board.range === "year") return `in ${board.day.slice(0, 4)}`;
  if (board.range === "span") return `from ${board.from} to ${board.day}`;
  if (board.day === board.today) return "today";
  const d = new Date(`${board.day}T00:00:00Z`);
  const yesterday = new Date(`${board.today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (d.getTime() === yesterday.getTime()) return "yesterday";
  return `on ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`;
}

function Inner() {
  const { can } = useFeature();
  const search = useSearch({ from: "/data-center/call-centre" });

  /**
   * Who meets what first. An ordering, not a permission: the server decides
   * what anybody may read, and this decides what they meet first. Agents meet
   * their own work; whoever hands out work meets the control centre.
   */
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const layout = callCentreLayout({ canEdit, canManage });
  const agentFirst = layout === "agent";
  // An agent who opens the call centre lands on their own day (Phase 26, C4).
  const navigate = useNavigate();
  useEffect(() => {
    if (agentFirst) navigate({ to: "/data-center/my-calls", replace: true });
  }, [agentFirst, navigate]);

  const cc = useControlCentre({ canManage, canReview: canEdit, day: search.day, range: search.range });
  const agentsMeta = useAgentsMeta(canManage, cc.board?.refreshSeconds);
  const dayLabel = dayWords(cc.board);

  return (
    <div className="space-y-4">
      {cc.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{cc.error}</p>}

      {canEdit && agentFirst && <MyWork canEdit={canEdit} />}

      {/* The control centre (Phase 26, C2): the day's figures, the shift
          board, the pool by partner, what needs a decision, and what happened.
          One shared load, one refresh, so nothing here disagrees with its
          neighbour by a few seconds. The day lives in the URL. */}
      {canManage && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DayChips today={cc.board?.today} day={search.day} range={search.range} />
          </div>
          <Figures board={cc.board} metrics={cc.metrics} waiting={cc.waiting} canManage onRecomputed={cc.reload} />
          <ShiftBoard board={cc.board} agentsMeta={agentsMeta} canManage reload={() => { cc.reload(); }} dayLabel={dayLabel} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <WaitingByPartner partners={cc.partners} agentsMeta={agentsMeta} canManage reload={cc.reload} />
            <NeedsDecision board={cc.board} agentsMeta={agentsMeta} metrics={cc.metrics} waiting={cc.waiting} canManage reload={cc.reload} />
          </div>
          <HappenedToday activity={cc.activity} board={cc.board} canEdit={canEdit} dayLabel={dayLabel} />
        </>
      )}

      {/* The queue lives on the Records page (C3); a narrowing arriving here
          is sent on by the route. Whoever has no control centre gets the door
          to the records here, and a manager gets it at the end. */}
      <Link
        href="/data-center/call-centre/records"
        className="inline-flex items-center gap-1 rounded-md border border-(--dc-brief-stove) px-3 py-1.5 text-xs font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)"
        data-records-door
      >
        All call centre records
      </Link>

      {canEdit && !agentFirst && <MyWork canEdit={canEdit} hideWhenEmpty />}

    </div>
  );
}

export default function CallCentrePage() {
  return (
    <DataCentreShell
      title="Call Centre"
      description="Who is calling what today, what is waiting, and what each call concluded."
      breadcrumb="Call Centre"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}

import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import MyWork from "../features/call-centre/MyWork";
import SharedPhones from "../features/call-centre/SharedPhones";
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
import { wordsFor } from "../lib/outcome";
import { callCentreLayout } from "../lib/callCentreLayout";

/** The queue's own presets, named so a drill banner can say which one it took. */
const PRESET_LABELS = {
  todo: "never called",
  unresolved: "yet to be resolved",
  exhausted: "chased three times and still not verified",
  correction: "waiting on Sales",
  review: "fixed by Sales, awaiting review",
  recall_due: "due a call again after a fix",
  completed: "finished by the call centre",
  unconfirmed: "a serial number another caller took",
};

/** The scorecard columns, said the way the dashboard says them. */
const STATUS_LABELS = {
  verified: "verified",
  unverified: "partly verified",
  unreachable: "unreachable",
  unresolved: "yet to be resolved",
};

function dayWords(board) {
  if (!board) return "today";
  if (board.range === "week") return "this week";
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
  const navigate = useNavigate();

  // A drill-through arrives as URL params, gets translated to server filters
  // here, and is cleared by navigating to the bare URL. Nothing is held in
  // state, which is what lets back restore the dashboard and lets a filtered
  // queue be sent to someone as a link.
  const drill = useMemo(() => {
    const filters = {};
    for (const key of [
      "organizationId", "partnerState", "transferSalesRep", "assignedAgent", "agentManager",
    ]) {
      if (search[key]) filters[key] = search[key];
    }
    if (search.status && STATUS_LABELS[search.status]) {
      filters.outcomeGroup = search.status;
    }
    if (search.verificationOutcome) {
      filters.verificationOutcome = search.verificationOutcome;
    }
    const preset = PRESET_LABELS[search.preset] ? search.preset : null;
    if (Object.keys(filters).length === 0 && !preset) return null;
    const subject = search.label
      ?? (preset ? PRESET_LABELS[preset] : null)
      ?? (search.verificationOutcome ? wordsFor(search.verificationOutcome) : "the filters set on the queue");
    return {
      preset,
      filters,
      description: filters.outcomeGroup ? `${subject}: ${STATUS_LABELS[search.status]}` : subject,
      // Everything that narrows goes; the periods and the board's day are how
      // far back the reader is looking, not a narrowing, and stay.
      clear: () =>
        navigate({
          to: "/data-center/call-centre",
          search: (prev) => ({
            ...(prev.period ? { period: prev.period } : {}),
            ...(prev.day ? { day: prev.day } : {}),
            ...(prev.range ? { range: prev.range } : {}),
          }),
        }),
    };
  }, [search, navigate]);

  /**
   * Who meets what first. An ordering, not a permission: the server decides
   * what anybody may read, and this decides what they meet first. Agents meet
   * their own work; whoever hands out work meets the control centre.
   */
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const layout = callCentreLayout({ canEdit, canManage });
  const agentFirst = layout === "agent";

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

      {/* The queue and the register stay here until the Records page (C3)
          takes them; the drill-through contract from the dashboard lands on
          the queue and must keep working meanwhile. */}
      <CallQueue key={drill?.preset ?? "all"} canEdit={canEdit} drill={drill} agents={canManage ? agentsMeta?.agents ?? null : null} />

      {canEdit && !agentFirst && <MyWork canEdit={canEdit} hideWhenEmpty />}

      {can(DATA_CENTER_FEATURES.RECORDS_VIEW) && (
        <div id="shared-phones">
          <SharedPhones />
        </div>
      )}
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

import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import CallCentreBoard from "../features/call-centre/board/CallCentreBoard";
import AgentsPanel from "../features/call-centre/agents/AgentsPanel";
import PoolByPartner from "../features/call-centre/pool/PoolByPartner";
import { SendBacksLane, RecallsLane } from "../features/call-centre/lanes/Lanes";
import { useControlCentre } from "../features/call-centre/lib/useControlCentre";
import AssignmentLog from "../features/call-centre/AssignmentLog";
import MyWork from "../features/call-centre/MyWork";
import SharedPhones from "../features/call-centre/SharedPhones";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
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
  unconfirmed: "a stove ID another caller took",
};

/** The scorecard columns, said the way the dashboard says them. */
const STATUS_LABELS = {
  verified: "verified",
  unverified: "partly verified",
  unreachable: "unreachable",
  unresolved: "yet to be resolved",
};

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
    // One exact outcome, where a scorecard column's group of four is wider than
    // the number the reader clicked.
    if (search.verificationOutcome) {
      filters.verificationOutcome = search.verificationOutcome;
    }

    const preset = PRESET_LABELS[search.preset] ? search.preset : null;
    if (Object.keys(filters).length === 0 && !preset) return null;

    const subject = search.label
      ?? (preset ? PRESET_LABELS[preset] : null)
      ?? (search.verificationOutcome
        ? search.verificationOutcome.replace(/_/g, " ")
        : "a scorecard row");

    return {
      preset,
      filters,
      description: filters.outcomeGroup
        ? `${subject}: ${STATUS_LABELS[search.status]}`
        : subject,
      clear: () => navigate({ to: "/data-center/call-centre", search: {} }),
    };
  }, [search, navigate]);

  /**
   * A call agent lands on their own work, not on everybody's.
   *
   * They were shown the same page as a supervisor - the whole queue over the
   * whole assignment log - so the first act of every shift was working out
   * which of it was theirs. A supervisor still sees the queue first, because
   * their question is about the population and not about one person's day.
   *
   * Both see both. This is an ordering, not a permission: the server decides
   * what anybody may read, and this decides what they meet first.
   */
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const layout = callCentreLayout({ canEdit: can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT), canManage });
  const agentFirst = layout === "agent";

  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const cc = useControlCentre({ canManage, canReview: canEdit });

  return (
    <div className="space-y-4">
      {cc.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{cc.error}</p>}

      {/* Agents meet their own work first: the buyer is waiting on them. */}
      {canEdit && agentFirst && <MyWork canEdit={canEdit} />}

      {/* Whoever hands out work meets the control centre first: the board,
          the agents, the pool by partner, and the lanes of work that came
          back. All four draw from one refresh, so nothing here disagrees
          with its neighbour by a few seconds. */}
      {canManage && (
        <>
          <CallCentreBoard metrics={cc.metrics} agents={cc.agents} waiting={cc.waiting} canManage onRecomputed={cc.reload} />
          <AgentsPanel data={cc.agents} canManage reload={cc.reload} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <PoolByPartner metrics={cc.metrics} agents={cc.agents} canManage reload={cc.reload} />
            <div className="space-y-4">
              <SendBacksLane waiting={cc.waiting} metrics={cc.metrics} />
              <RecallsLane waiting={cc.waiting} metrics={cc.metrics} />
            </div>
          </div>
        </>
      )}

      <CallQueue key={drill?.preset ?? "all"} canEdit={canEdit} drill={drill} />

      {/* A supervisor gets their own queue after everybody's: they ask about
          everybody first and about themselves rarely, which is the opposite
          of an agent and the reason this is ordered rather than hidden. */}
      {canEdit && !agentFirst && <MyWork canEdit={canEdit} hideWhenEmpty />}

      {/* The register sits with the call centre because that is where a
          shared number stops being a suspicion and becomes a fact: somebody
          rings it and finds out whether it is one household or one typo. */}
      {can(DATA_CENTER_FEATURES.RECORDS_VIEW) && <SharedPhones />}

      {/* History only. The levers moved to the agents panel, beside the
          people they affect. */}
      {can(DATA_CENTER_FEATURES.RECORDS_VIEW) && <AssignmentLog canEdit={canEdit} />}
    </div>
  );
}

export default function CallCentrePage() {
  return (
    <DataCentreShell
      title="Call Centre"
      description="The verification queue, and what each call concluded."
      breadcrumb="Call Centre"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}

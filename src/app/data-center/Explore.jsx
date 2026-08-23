import Link from "@/compat/Link";
import { useFeature } from "./lib/access";
import StoveFinder from "./features/stove-record/StoveFinder";
import { DATA_CENTER_FEATURES } from "./lib/features";
import {
  BarChart3, PhoneCall, Handshake, Database, Upload, Settings2, Lock, ArrowRight,
  TrendingUp,
} from "lucide-react";

/**
 * The Data Centre's landing view.
 *
 * It used to be one page carrying every surface stacked vertically, which meant
 * a call agent scrolled past dashboards and imports to reach their queue, and
 * every area shared one URL. Now each area is its own route, and this is the
 * hub that points at them.
 *
 * A card the user cannot open is shown locked rather than hidden. Hiding it
 * makes the module look smaller than it is and leaves someone wondering why a
 * colleague can see something they cannot; showing it locked says what is
 * missing and who to ask.
 *
 * Administration is the sixth card rather than a panel below the grid. It used
 * to render inline, which meant an administrator opening the hub to reach the
 * call queue scrolled past a user list and an audit log to get there, and the
 * two things that most need room to read had the least.
 */

const AREAS = [
  {
    key: DATA_CENTER_FEATURES.DASHBOARD_VIEW,
    href: "/data-center/dashboard",
    area: "dashboard",
    name: "Dashboard",
    icon: BarChart3,
    blurb: "Scorecards over sold against recovered, by partner, place, rep, agent and manager.",
  },
  {
    key: DATA_CENTER_FEATURES.CALL_RECORDS_VIEW,
    href: "/data-center/call-centre",
    area: "call-centre",
    name: "Call Centre",
    icon: PhoneCall,
    blurb: "The verification queue, call outcomes, corrections and the assignment log.",
  },
  {
    key: DATA_CENTER_FEATURES.RECORDS_VIEW,
    href: "/data-center/partner-records",
    area: "partner-records",
    name: "Partner Records",
    icon: Handshake,
    blurb: "What was issued to each partner and how much of it has come back.",
  },
  {
    key: DATA_CENTER_FEATURES.RECORDS_VIEW,
    href: "/data-center/stove-records",
    area: "stove-records",
    name: "Stove Records",
    icon: Database,
    blurb: "Every sold stove with the detail captured at the point of sale.",
  },
  {
    // Either the uploader or the bench opens it, so the card unlocks on
    // either. AreaCard names the first key when it is locked, which is the
    // one most people are missing.
    key: DATA_CENTER_FEATURES.IMPORT_UPLOAD,
    altKey: DATA_CENTER_FEATURES.DIGITISATION_WORK,
    href: "/data-center/import",
    area: "import",
    name: "Bulk Import",
    blurb: "Receipts typed at the bench or uploaded in bulk, released on confirmation.",
    icon: Upload,
  },
  {
    key: DATA_CENTER_FEATURES.ANALYSIS_VIEW,
    href: "/data-center/analysis",
    area: "analysis",
    name: "Analysis",
    icon: TrendingUp,
    blurb: "Which partner is sitting on stock, and how much of what was sold is usable.",
  },
  {
    key: DATA_CENTER_FEATURES.GRANTS_MANAGE,
    href: "/data-center/settings",
    area: "settings",
    name: "Settings",
    icon: Settings2,
    blurb: "Who may use the module, and the log of everything anyone changed in it.",
  },
];

/**
 * One card per area, wearing the colour that area's pages wear.
 *
 * The accent is set on the card itself rather than inherited from the hub, so
 * the grid previews five destinations at a glance and arriving somewhere is
 * confirmed by colour before any label is read.
 */
function AreaCard({ area, unlocked }) {
  const Icon = area.icon;

  const body = (
    <div className="flex items-start gap-3.5">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${
          unlocked
            ? "bg-(--dc-accent) text-white shadow-sm"
            : "bg-gray-200 text-gray-500"
        }`}
      >
        {unlocked ? <Icon className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <h2
          className={`flex items-center gap-1.5 text-base font-semibold ${
            unlocked ? "text-(--dc-accent-strong)" : "text-gray-700"
          }`}
        >
          {area.name}
          {unlocked && (
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 text-(--dc-accent)/50 transition group-hover:translate-x-0.5 group-hover:text-(--dc-accent)"
            />
          )}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{area.blurb}</p>
        {!unlocked && (
          <p className="mt-2 text-xs text-gray-500">
            Needs <code className="rounded bg-gray-200 px-1 py-0.5">{area.key}</code>
          </p>
        )}
      </div>
    </div>
  );

  if (!unlocked) {
    return (
      <div
        aria-disabled="true"
        className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={area.href}
      aria-label={`Open ${area.name}`}
      data-area={area.area}
      className="dc-root group block overflow-hidden rounded-xl border-2 border-(--dc-accent)/25 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-(--dc-accent)/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--dc-accent)"
    >
      {body}
    </Link>
  );
}

export default function Explore() {
  const { can } = useFeature();

  return (
    <div className="space-y-4">
      {/*
        The finder is above the grid, not inside it.

        Every card here answers a question about a population - which partners,
        which agents, which imports. The single most common arrival is somebody
        holding one serial, and for them the whole grid is a detour. It only
        shows to people who can read records; for anyone else it would be a box
        whose every answer is a refusal.
      */}
      {can(DATA_CENTER_FEATURES.RECORDS_VIEW) && <StoveFinder />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {AREAS.map((area) => (
        <AreaCard
            key={area.href}
            area={area}
            unlocked={can(area.key) || (area.altKey ? can(area.altKey) : false)}
          />
        ))}
      </div>
    </div>
  );
}

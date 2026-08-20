import Link from "@/compat/Link";
import { useFeature } from "./lib/access";
import { DATA_CENTER_FEATURES } from "./lib/features";
import AccessManager from "./features/access/AccessManager";
import {
  BarChart3, PhoneCall, Handshake, Database, Upload, Lock, ArrowRight,
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
 */

const AREAS = [
  {
    key: DATA_CENTER_FEATURES.DASHBOARD_VIEW,
    href: "/data-center/dashboard",
    name: "Dashboard",
    icon: BarChart3,
    blurb: "Scorecards over sold against recovered, by partner, place, rep, agent and manager.",
  },
  {
    key: DATA_CENTER_FEATURES.CALL_RECORDS_VIEW,
    href: "/data-center/call-centre",
    name: "Call Centre",
    icon: PhoneCall,
    blurb: "The verification queue, call outcomes, corrections and the assignment log.",
  },
  {
    key: DATA_CENTER_FEATURES.RECORDS_VIEW,
    href: "/data-center/partner-records",
    name: "Partner Records",
    icon: Handshake,
    blurb: "What was issued to each partner and how much of it has come back.",
  },
  {
    key: DATA_CENTER_FEATURES.RECORDS_VIEW,
    href: "/data-center/stove-records",
    name: "Stove Records",
    icon: Database,
    blurb: "Every sold stove with the detail captured at the point of sale.",
  },
  {
    key: DATA_CENTER_FEATURES.IMPORT_UPLOAD,
    href: "/data-center/import",
    name: "Bulk Import",
    icon: Upload,
    blurb: "Digitalized receipts, validated against stock before anything is committed.",
  },
];

function AreaCard({ area, unlocked }) {
  const Icon = area.icon;

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
            unlocked ? "bg-(--dc-primary)/10 text-(--dc-primary)" : "bg-gray-200 text-gray-500"
          }`}
        >
          {unlocked ? <Icon className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
            {area.name}
            {unlocked && <ArrowRight className="h-4 w-4 text-gray-400" />}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{area.blurb}</p>
          {!unlocked && (
            <p className="mt-2 text-xs text-gray-500">
              Needs <code className="rounded bg-gray-200 px-1 py-0.5">{area.key}</code>
            </p>
          )}
        </div>
      </div>
    </>
  );

  if (!unlocked) {
    return (
      <div
        aria-disabled="true"
        className="rounded-xl border border-gray-200 bg-gray-50 p-5 opacity-70"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={area.href}
      aria-label={`Open ${area.name}`}
      className="block rounded-xl border border-(--dc-primary)/25 bg-white p-5 transition hover:border-(--dc-primary)/50 hover:shadow-sm"
    >
      {body}
    </Link>
  );
}

export default function Explore() {
  const { can, isSuperAdmin } = useFeature();
  const canManageAccess = isSuperAdmin || can(DATA_CENTER_FEATURES.GRANTS_MANAGE);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((area) => (
          <AreaCard key={area.href} area={area} unlocked={can(area.key)} />
        ))}
      </div>

      {/* Access administration stays on the hub rather than getting a card of
          its own: it is about who may use the module, not an area of it. */}
      {canManageAccess && <AccessManager />}
    </div>
  );
}

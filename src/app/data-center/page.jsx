import { Suspense } from "react";
import ProtectedRoute from "../components/ProtectedRoute";
import DashboardLayout from "../components/DashboardLayout";
import { DataCenterAccessProvider, useFeature } from "./lib/access";
import { DATA_CENTER_FEATURES, FEATURE_LABELS } from "./lib/features";
import {
  Database,
  PhoneCall,
  Upload,
  BarChart3,
  AlertTriangle,
  Loader2,
  Lock,
} from "lucide-react";

// Each surface the module will grow, and the tier-2 key that unlocks it.
// Phase 2 renders them as placeholders on purpose: the point of this slice is
// that the gate works, not that the features do.
const SURFACES = [
  {
    key: DATA_CENTER_FEATURES.RECORDS_VIEW,
    name: "Sold Stove Records",
    icon: Database,
    blurb: "Every sold stove with its sale detail. Phase 3.",
  },
  {
    key: DATA_CENTER_FEATURES.CALL_RECORDS_VIEW,
    name: "Call Centre",
    icon: PhoneCall,
    blurb: "Verification outcomes, call attempts and corrections. Phase 4.",
  },
  {
    key: DATA_CENTER_FEATURES.IMPORT_UPLOAD,
    name: "Bulk Import",
    icon: Upload,
    blurb: "Digitalized receipts, validated against stock. Phase 5.",
  },
  {
    key: DATA_CENTER_FEATURES.DASHBOARD_VIEW,
    name: "Dashboards",
    icon: BarChart3,
    blurb: "Computed metrics, read from snapshots. Phase 6.",
  },
];

function SurfaceCard({ surface, unlocked }) {
  const Icon = surface.icon;
  return (
    <div
      className={`rounded-xl border p-5 transition ${
        unlocked
          ? "border-[#4a5d0f]/25 bg-white"
          : "border-gray-200 bg-gray-50 opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            unlocked ? "bg-[#4a5d0f]/10 text-[#4a5d0f]" : "bg-gray-200 text-gray-500"
          }`}
        >
          {unlocked ? <Icon className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{surface.name}</h3>
          <p className="mt-1 text-sm text-gray-600">{surface.blurb}</p>
          {!unlocked && (
            <p className="mt-2 text-xs text-gray-500">
              Requires <code className="rounded bg-gray-200 px-1 py-0.5">{surface.key}</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DataCenterHome() {
  const { can, loading, error, isSuperAdmin, grantedFeatures } = useFeature();

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your Data Center access...
      </div>
    );
  }

  // Fail closed: no grants resolved means nothing is offered, rather than a UI
  // that presents actions the server will refuse.
  if (error) {
    return (
      <div className="m-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-medium text-amber-900">
            Data Center access could not be confirmed
          </p>
          <p className="mt-1 text-sm text-amber-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-8 pt-2">
      <div className="mb-6 overflow-hidden rounded-lg border border-[#4a5d0f]/20">
        <div className="flex items-center gap-4 bg-gradient-to-r from-[#4a5d0f] to-[#6b8016] px-6 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/15">
            <Database className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold leading-tight text-white md:text-2xl">
              Data Center
            </h1>
            <p className="mt-0.5 text-sm text-white/80">
              Computation and dashboards over sold stove records.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SURFACES.map((surface) => (
          <SurfaceCard key={surface.key} surface={surface} unlocked={can(surface.key)} />
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-100 bg-[#fafafa] p-5">
        <h2 className="text-sm font-semibold text-gray-900">Your access</h2>
        <p className="mt-1 text-sm text-gray-600">
          {isSuperAdmin
            ? "Super admin, so every Data Center feature is available."
            : grantedFeatures.size === 0
              ? "No Data Center features have been granted to you yet."
              : `${grantedFeatures.size} of ${SURFACES.length + 5} features granted.`}
        </p>
        {!isSuperAdmin && grantedFeatures.size > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {[...grantedFeatures].map((f) => (
              <li
                key={f}
                className="rounded-full bg-[#4a5d0f]/10 px-3 py-1 text-xs font-medium text-[#4a5d0f]"
              >
                {FEATURE_LABELS[f] ?? f}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function DataCenterPage() {
  return (
    // Tier 1: the host app's own route map decides whether this module exists
    // for this user at all. Granted to super_admin only until the module is
    // proven, which is what makes merging to main safe.
    <ProtectedRoute routeKey="data-center">
      <DashboardLayout
        currentRoute="data-center"
        title="Data Center"
        description="Computation and dashboards over sold stove records"
      >
        <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
          {/* Tier 2: per-user feature grants, resolved from the database. */}
          <DataCenterAccessProvider>
            <DataCenterHome />
          </DataCenterAccessProvider>
        </Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

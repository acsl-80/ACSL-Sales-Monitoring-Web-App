import { Suspense } from "react";
import ProtectedRoute from "../components/ProtectedRoute";
import DashboardLayout from "../components/DashboardLayout";
import { DataCenterAccessProvider, useFeature } from "./lib/access";
import {
  DATA_CENTER_FEATURES,
  ALL_DATA_CENTER_FEATURES,
  FEATURE_LABELS,
} from "./lib/features";
import AccessManager from "./features/access/AccessManager";
import RecordsTable from "./features/records/RecordsTable";
import CallQueue from "./features/call-centre/CallQueue";
import {
  Database,
  PhoneCall,
  Upload,
  BarChart3,
  AlertTriangle,
  Loader2,
  Lock,
  ShieldOff,
  Eye,
  Pencil,
} from "lucide-react";

// The surfaces this module will grow, and the tier-2 key that unlocks each.
// Sold Stove Records is built (Phase 3) and renders below rather than as a
// card; the rest are still placeholders.
const SURFACES = [
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

function AccessDenied() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
      <ShieldOff className="mx-auto h-10 w-10 text-gray-400" />
      <h1 className="mt-4 text-lg font-semibold text-gray-900">
        No Data Center access
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        Access is granted per person by an administrator. If you need it, ask a
        super admin to add you from the Data Center's access section.
      </p>
    </div>
  );
}

function DataCenterHome() {
  const { can, hasAccess, accessRole, loading, error, isSuperAdmin, grantedFeatures } =
    useFeature();

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

  // The real tier-1 gate: super_admin always, everyone else case by case.
  // The edge functions enforce the same rule, so this is presentation.
  if (!hasAccess) {
    return <AccessDenied />;
  }

  const canManageAccess = isSuperAdmin || can(DATA_CENTER_FEATURES.GRANTS_MANAGE);

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
          {accessRole && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
              {accessRole === "editor" ? (
                <Pencil className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
              {accessRole === "editor" ? "Editor" : "Viewer"}
            </span>
          )}
        </div>
      </div>

      {/* Table 1. The feature gate is presentation: data-center-read re-checks
          records.view on every request and returns 403 without it. */}
      {can(DATA_CENTER_FEATURES.RECORDS_VIEW) ? (
        <RecordsTable />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
          Sold stove records are not part of your access.
        </div>
      )}

      {/* Table 2. call_records.view admits a viewer; call_records.edit is what
          the editor checks before it offers to change anything. Both are
          re-checked server-side on every call. */}
      {can(DATA_CENTER_FEATURES.CALL_RECORDS_VIEW) && (
        <div className="mt-6">
          <CallQueue canEdit={can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT)} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
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
              : `${accessRole === "editor" ? "Editor" : "Viewer"} access, ${grantedFeatures.size} of ${ALL_DATA_CENTER_FEATURES.length} features.`}
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

      {/* Access administration. Super admins, or a grants.manage holder.
          The section is for access only. */}
      {canManageAccess && (
        <div className="mt-6">
          <AccessManager />
        </div>
      )}
    </div>
  );
}

export default function DataCenterPage() {
  return (
    // Session gate only: no routeKey. The host's static route map cannot
    // express "this particular user was enabled", so tier 1 for this module is
    // the per-user check inside DataCenterHome, backed by the same rule in
    // every edge function. super_admin passes implicitly; everyone else needs
    // a module_access row, granted case by case.
    <ProtectedRoute>
      <DashboardLayout
        currentRoute="data-center"
        title="Data Center"
        description="Computation and dashboards over sold stove records"
      >
        <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
          <DataCenterAccessProvider>
            <DataCenterHome />
          </DataCenterAccessProvider>
        </Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

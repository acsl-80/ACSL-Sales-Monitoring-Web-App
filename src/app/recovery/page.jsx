import ProtectedRoute from "../components/ProtectedRoute";
import DashboardLayout from "../components/DashboardLayout";
import { RecoveryAccessProvider, useRecoveryAccess } from "./lib/access";
import { LEVEL_LABELS } from "./lib/features";
import { AlertTriangle, Loader2, ShieldOff, ArchiveRestore } from "lucide-react";

/**
 * /recovery, the module's front door.
 *
 * R1 builds the rig and nothing that reads a record, so once someone is in,
 * the page says what they hold and that records arrive with the next slice.
 * The three states before that (checking, could not check, no access) are the
 * part that matters now, because they are what every later page sits behind.
 */
function Body() {
  const { loading, error, hasAccess, accessLevel, isSuperAdmin } = useRecoveryAccess();

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your Recovery access...
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <p className="text-sm font-medium text-amber-900">Recovery access could not be confirmed</p>
          <p className="mt-1 text-sm text-amber-900">{error}</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-300 bg-white p-8 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-gray-500" />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">No Recovery access</h1>
        <p className="mt-2 text-sm text-gray-700">
          Access is granted per person by a super admin. If you need it, ask one to add you.
        </p>
      </div>
    );
  }

  const holding = isSuperAdmin ? "Super admin" : LEVEL_LABELS[accessLevel] ?? accessLevel;

  return (
    <div className="px-4 pb-10 pt-2 sm:px-6">
      <div className="mb-6 mt-4 flex flex-wrap items-center gap-3 border-b-2 border-gray-200 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-gray-900 sm:text-2xl">Recovery</h1>
          <p className="mt-1 text-sm text-gray-700">
            Rebuilding the records of stoves sold from 2022 to 2025
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white">
          {holding}
        </span>
      </div>

      <div className="mx-auto mt-12 max-w-md text-center">
        <ArchiveRestore className="mx-auto h-10 w-10 text-gray-500" />
        <h2 className="mt-4 text-base font-semibold text-gray-900">No records yet</h2>
        <p className="mt-2 text-sm text-gray-700">
          Recovered stoves will be listed here once the first partner&apos;s records are loaded.
        </p>
      </div>
    </div>
  );
}

export default function RecoveryPage() {
  return (
    // Session gate only, no routeKey: staff are let in per person, which the
    // static role map cannot express. Entry is decided by the server, inside.
    <ProtectedRoute>
      <DashboardLayout
        currentRoute="recovery"
        title="Recovery"
        description="Rebuilding the records of stoves sold from 2022 to 2025"
      >
        <RecoveryAccessProvider>
          <Body />
        </RecoveryAccessProvider>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

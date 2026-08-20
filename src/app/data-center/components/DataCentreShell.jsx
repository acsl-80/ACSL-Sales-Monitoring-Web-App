import { Suspense } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import DashboardLayout from "../../components/DashboardLayout";
import { DataCenterAccessProvider, useFeature } from "../lib/access";
import Link from "@/compat/Link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ArrowLeft, Loader2, AlertTriangle, ShieldOff, Eye, Pencil } from "lucide-react";

/**
 * The frame every Data Centre page sits in.
 *
 * Written once because five pages needed the same six things: a session gate,
 * the host layout, the access provider, breadcrumbs, a way back to Explore, and
 * the three states before any of that matters (loading, error, denied). Five
 * copies of that is five places for the denied state to drift.
 *
 * The sidebar needs nothing from us. DashboardLayout's
 * deriveCurrentRouteFromPath falls through to segments[0], so every child of
 * /data-center already highlights the right nav entry. That is why this module
 * still edits exactly two shared files.
 */

function Shell({ title, description, breadcrumb, feature, children }) {
  const { can, hasAccess, accessRole, loading, error } = useFeature();

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your Data Center access...
      </div>
    );
  }

  // Fail closed: if grants could not be resolved, offer nothing rather than
  // offering actions the server will refuse.
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

  if (!hasAccess) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-gray-400" />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">
          No Data Center access
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Access is granted per person by an administrator. If you need it, ask a
          super admin to add you from the Data Center&apos;s access section.
        </p>
      </div>
    );
  }

  // A page whose feature is not granted says so, rather than rendering a
  // surface whose every request would come back 403.
  if (feature && !can(feature)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-gray-400" />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">
          Not part of your access
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          This area needs <code className="rounded bg-gray-100 px-1">{feature}</code>.
        </p>
        <Link
          href="/data-center"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#4a5d0f] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Explore
        </Link>
      </div>
    );
  }

  return (
    <div className="px-6 pb-8 pt-2">
      {breadcrumb && (
        <div className="mb-4 flex items-center gap-3">
          <Link
            href="/data-center"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" /> Explore
          </Link>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/data-center">Data Center</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{breadcrumb}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-gray-900">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-gray-600">{description}</p>}
        </div>
        {accessRole && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {accessRole === "editor" ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {accessRole === "editor" ? "Editor" : "Viewer"}
          </span>
        )}
      </div>

      {children}
    </div>
  );
}

export default function DataCentreShell({
  title,
  description,
  breadcrumb,
  feature,
  children,
}) {
  return (
    // Session gate only, no routeKey. The host's static role map cannot express
    // "this particular user was enabled", so entry is decided by the per-user
    // check inside, backed by the same rule in every edge function.
    <ProtectedRoute>
      <DashboardLayout
        currentRoute="data-center"
        title="Data Center"
        description="Computation and dashboards over sold stove records"
      >
        <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
          <DataCenterAccessProvider>
            <Shell
              title={title}
              description={description}
              breadcrumb={breadcrumb}
              feature={feature}
            >
              {children}
            </Shell>
          </DataCenterAccessProvider>
        </Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

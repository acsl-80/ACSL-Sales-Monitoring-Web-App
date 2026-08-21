import { Suspense } from "react";
import "../theme.css";
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
 *
 * `area` sets the accent every surface below inherits. One hue per area, from
 * the Explore card through to the page it opens, so colour answers "where am
 * I" before any label does. theme.css holds the values.
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

  /**
   * A page whose feature is not granted says so, rather than rendering a
   * surface whose every request would come back 403.
   *
   * `feature` may be a list, meaning any one of them opens the page. Bulk
   * Import needs that: it holds the uploader and the workbench, and somebody
   * granted only the bench should still get in rather than being told they
   * lack a permission for a panel they were not going to use.
   */
  const needed = feature ? (Array.isArray(feature) ? feature : [feature]) : null;
  if (needed && !needed.some((key) => can(key))) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-8 text-center shadow-sm">
        <ShieldOff className="mx-auto h-10 w-10 text-gray-400" />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">
          Not part of your access
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          This area needs{" "}
          {needed.map((key, i) => (
            <span key={key}>
              {i > 0 ? " or " : ""}
              <code className="rounded bg-gray-100 px-1">{key}</code>
            </span>
          ))}
          .
        </p>
        <Link
          href="/data-center"
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong)"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Explore
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 pb-10 pt-2 sm:px-6">
      {breadcrumb && (
        <div className="mb-4 flex items-center gap-3">
          <Link
            href="/data-center"
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/25 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
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

      <div className="mb-6 flex flex-wrap items-center gap-3 border-b-2 border-(--dc-accent)/20 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-gray-900 sm:text-2xl">
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
        </div>
        {accessRole && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-(--dc-accent-soft) px-3 py-1 text-xs font-medium text-(--dc-accent-strong)">
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
  area = "explore",
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
        <div className="dc-root" data-area={area}>
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
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

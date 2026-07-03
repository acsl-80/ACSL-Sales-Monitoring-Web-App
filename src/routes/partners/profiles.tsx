import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";

const PartnerProfilesContent = lazy(
  () => import("@/app/user-management/partner-profiles/PartnerProfilesContent")
);

function PartnerProfilesPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="partners-profiles">
      <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
        <PartnerProfilesContent />
      </Suspense>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/partners/profiles")({
  component: PartnerProfilesPage,
});

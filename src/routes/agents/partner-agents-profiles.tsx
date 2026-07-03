import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";

const PartnerAgentsProfilesContent = lazy(
  () => import("@/app/agents/partner-agents-profiles/PartnerAgentsProfilesContent")
);

function PartnerAgentsProfilesPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="partner-agents-profiles">
      <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
        <PartnerAgentsProfilesContent />
      </Suspense>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/agents/partner-agents-profiles")({
  component: PartnerAgentsProfilesPage,
});

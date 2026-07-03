import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";

const AgentsProfilesContent = lazy(
  () => import("@/app/agents/agents-profiles/AgentsProfilesContent")
);

function AgentsProfilesPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="agents-profiles">
      <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
        <AgentsProfilesContent />
      </Suspense>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/agents/profiles")({
  component: AgentsProfilesPage,
});

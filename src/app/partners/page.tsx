
import { Suspense } from "react";
import ProtectedRoute from "../components/ProtectedRoute";
import PartnersContent from "./components/PartnersContent";

export default function PartnersPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="partners">
      <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
        <PartnersContent />
      </Suspense>
    </ProtectedRoute>
  );
}

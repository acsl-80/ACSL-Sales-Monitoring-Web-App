
import { Suspense } from "react";
import ProtectedRoute from "../components/ProtectedRoute";
import { usePermissions } from "../hooks/usePermissions";
import UnifiedSalesContent from "./components/UnifiedSalesContent";

function SalesRouter() {
  return <UnifiedSalesContent />;
}

export default function SalesPage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
        <SalesRouter />
      </Suspense>
    </ProtectedRoute>
  );
}

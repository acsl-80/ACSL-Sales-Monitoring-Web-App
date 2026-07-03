
import ProtectedRoute from "../components/ProtectedRoute";
import UnifiedDashboardContent from "./components/UnifiedDashboardContent";

export default function DashboardPage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <UnifiedDashboardContent />
    </ProtectedRoute>
  );
}

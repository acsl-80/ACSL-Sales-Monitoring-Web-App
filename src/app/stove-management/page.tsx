import ProtectedRoute from "../components/ProtectedRoute";
import StoveManagementContent from "./components/StoveManagementContent";

export default function StoveManagementPage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <StoveManagementContent />
    </ProtectedRoute>
  );
}

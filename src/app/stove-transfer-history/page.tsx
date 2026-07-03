
import ProtectedRoute from "../components/ProtectedRoute";
import StoveTransferHistoryContent from "./components/StoveTransferHistoryContent";

export default function StoveTransferHistoryPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="stove-transfer-history">
      <StoveTransferHistoryContent />
    </ProtectedRoute>
  );
}

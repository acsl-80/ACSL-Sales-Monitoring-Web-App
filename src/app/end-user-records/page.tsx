import ProtectedRoute from "../components/ProtectedRoute";
import EndUserRecordsContent from "./EndUserRecordsContent";

export default function EndUserRecordsPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="end-user-records">
      <EndUserRecordsContent />
    </ProtectedRoute>
  );
}

import ProtectedRoute from "../../components/ProtectedRoute";
import CancelledTransactionsContent from "./CancelledTransactionsContent";

export default function CancelledTransactionsPage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <CancelledTransactionsContent />
    </ProtectedRoute>
  );
}

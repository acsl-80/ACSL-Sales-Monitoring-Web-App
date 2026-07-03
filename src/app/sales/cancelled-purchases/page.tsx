import ProtectedRoute from "../../components/ProtectedRoute";
import CancelledPurchasesContent from "./CancelledPurchasesContent";

export default function CancelledPurchasesPage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <CancelledPurchasesContent />
    </ProtectedRoute>
  );
}

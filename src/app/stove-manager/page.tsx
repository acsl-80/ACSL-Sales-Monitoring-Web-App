
import ProtectedRoute from "../components/ProtectedRoute";
import StoveManagerContent from "./components/StoveManagerContent";

export default function StoveManagerPage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <StoveManagerContent />
    </ProtectedRoute>
  );
}

import ProtectedRoute from "../components/ProtectedRoute";
import SystemDocumentationContent from "./SystemDocumentationContent";

export default function SystemDocumentationPage() {
  return (
    <ProtectedRoute requireSuperAdmin>
      <SystemDocumentationContent />
    </ProtectedRoute>
  );
}

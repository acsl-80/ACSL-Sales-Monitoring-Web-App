import ProtectedRoute from "../components/ProtectedRoute";
import UserGuideContent from "./UserGuideContent";

export default function UserGuidePage() {
  return (
    <ProtectedRoute>
      <UserGuideContent />
    </ProtectedRoute>
  );
}

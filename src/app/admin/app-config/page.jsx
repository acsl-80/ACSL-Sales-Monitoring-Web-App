import { Navigate } from "@/compat/navigation";

export default function AdminAppConfigRedirect() {
  return <Navigate to="/settings/system-config" />;
}

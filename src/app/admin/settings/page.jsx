import { Navigate } from "@/compat/navigation";

export default function AdminSettingsRedirect() {
  // There is no /settings route; the group's first page is system config.
  return <Navigate to="/settings/system-config" />;
}

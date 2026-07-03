
import { usePermissions } from "../hooks/usePermissions";
import type { FeatureKey } from "@/lib/permissions";

interface RoleGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function RoleGate({ feature, children, fallback = null }: RoleGateProps) {
  const { can } = usePermissions();
  return can(feature) ? <>{children}</> : <>{fallback}</>;
}

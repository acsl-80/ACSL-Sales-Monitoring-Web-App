import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/compat/navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import DashboardLayout from "../../components/DashboardLayout";
import { useAuth } from "../../contexts/useAuth";
import { usePermissions } from "../../hooks/usePermissions";

type ChangeControlGuardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * Change Control is gated by the `change-control-link` feature — the same
 * flag that shows or hides the sidebar footer button — not by an entry in
 * the PERMISSIONS route map, so ProtectedRoute's own `routeKey` gate (the
 * usual way a page is protected here) does not apply to it. This does the
 * same job by hand: once the role is known, anyone without the feature is
 * sent to /unauthorized, the app's usual treatment for a page they cannot
 * reach. A signed-out visitor is not one of those cases: the root
 * ProtectedRoute already sends them to /login, so this only redirects once
 * someone is actually signed in and still lacks the feature — otherwise a
 * signed-out person briefly heading to /login was also being sent to
 * /unauthorized first.
 */
export default function ChangeControlGuard({
  title,
  description,
  children,
}: ChangeControlGuardProps) {
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();
  const { can } = usePermissions();
  const allowed = can("change-control-link");

  useEffect(() => {
    if (!loading && isAuthenticated && !allowed) router.push("/unauthorized");
  }, [loading, isAuthenticated, allowed, router]);

  return (
    <ProtectedRoute>
      <DashboardLayout currentRoute="change-control" title={title} description={description}>
        {loading || !allowed ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
          </div>
        ) : (
          children
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}

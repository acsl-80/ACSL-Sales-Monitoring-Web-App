
import { useEffect } from "react";
import { useAuth } from "./contexts/useAuth";
import { useRouter } from "@/compat/navigation";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      router.push("/login");
    } else {
      // All authenticated users land on the unified dashboard.
      router.push("/dashboard");
    }
  }, [isAuthenticated, loading, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-700"></div>
    </div>
  );
}


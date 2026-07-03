/* eslint-disable react/no-unescaped-entities */

import { useAuth } from "../contexts/useAuth";
import { useRouter } from "@/compat/navigation";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

export default function UnauthorizedPage() {
  const { signOut, user, isSuperAdmin, isAdmin, isPartner, isAcslAgent, isSuperAdminAgent, getStoredProfile } = useAuth();
  const router = useRouter();
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    // Get user profile information
    const profile = getStoredProfile();
    if (profile) {
      setUserInfo({
        role: isSuperAdmin
          ? "Super Admin"
          : (isAcslAgent || isSuperAdminAgent)
            ? "ACSL Agent"
            : (isPartner || isAdmin)
              ? "Partner"
              : profile.role || "User",
        organization: profile.organization_name || profile.organizations?.name,
      });
    }
  }, [getStoredProfile, isSuperAdmin, isAdmin]);

  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = "/login";
    } catch (error) {
      console.error("Error during logout:", error);
      window.location.href = "/login";
    }
  };

  const handleGoToDashboard = () => {
    // Route to appropriate dashboard based on role
    if (isSuperAdmin) {
      router.push("/dashboard");
    } else if (isAdmin) {
      router.push("/admin");
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
            <AlertCircle className="h-6 w-6 text-gray-600" />
          </div>

          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Page Not Found
          </h1>

          <p className="text-gray-600 mb-6">
            The page you're looking for doesn't exist or you don't have access
            to it.
          </p>

          {userInfo && (
            <div className="mb-6 p-3 bg-gray-50 rounded-md border border-gray-200">
              <p className="text-sm text-gray-700">
                You are logged in as{" "}
                <span className="font-medium">{userInfo.role}</span>
                {userInfo.organization && (
                  <>
                    {" "}
                    for{" "}
                    <span className="font-medium">{userInfo.organization}</span>
                  </>
                )}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={handleGoToDashboard}
              className="w-full bg-brand hover:bg-brand/90 text-white"
            >
              <Home className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>

            <Button
              onClick={handleSignOut}
              variant="outline"
              className="w-full"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Log Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

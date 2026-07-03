
import { useState, useEffect } from "react";
import Image from "@/compat/Image";
import { useRouter } from "@/compat/navigation";
import { useAuth } from "../contexts/useAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import Link from "@/compat/Link";

// All authenticated users land on the unified Super Admin dashboard.
// Data-scoping and per-role menu visibility happens inside the app.
const getRouteForRole = (role) => {
  if (!role) return null;
  return "/dashboard";
};


const LoginPage = () => {
  const [loginData, setLoginData] = useState({
    identifier: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const {
    signInWithCredentials,
    isAuthenticated,
    isSuperAdmin,
    isAdmin,
    isPartner,
    isAgent,
    isPartnerAgent,
    isSuperAdminAgent,
    isAcslAgent,
    isAcslAgentManager,
    userRole,
    loading: authLoading,
  } = useAuth();
  const router = useRouter();

  const getRouteFromCurrentAuth = () => {
    const roleRoute = getRouteForRole(userRole);
    if (roleRoute) return roleRoute;
    if (isSuperAdmin || isAcslAgentManager) return "/dashboard";
    if (isAcslAgent || isSuperAdminAgent) return "/super-admin-agent";
    if (isPartner || isAdmin) return "/admin";
    if (isPartnerAgent || isAgent) return "/admin/sales";
    return null;
  };

  // If a valid session already exists, keep it and redirect instead of clearing it.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const route = getRouteFromCurrentAuth();
      if (route) router.push(route);
    }
  }, [
    isAuthenticated,
    authLoading,
    isSuperAdmin,
    isAdmin,
    isPartner,
    isAgent,
    isPartnerAgent,
    isSuperAdminAgent,
    isAcslAgent,
    isAcslAgentManager,
    userRole,
    router,
  ]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error: authError } = await signInWithCredentials(
        loginData.identifier,
        loginData.password
      );

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      const role =
        data?.role ||
        data?.profile?.role ||
        data?.user?.app_metadata?.role ||
        data?.user?.user_metadata?.role;
      router.push(getRouteForRole(role) || "/unauthorized");
    } catch (err) {
      setError("Login failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 relative">
      {/* Download App Link - Top Right */}
      {/* <div className="absolute top-4 right-4">
        <Link href="/download">
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Download App
          </Button>
        </Link>
      </div> */}

      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardHeader className="text-center pb-8">
          <div className="mb-6">
            <Image
              src="/logo.png"
              alt="Atmosfair Logo"
              width={120}
              height={60}
              className="mx-auto h-16 w-auto"
            />
          </div>
        </CardHeader>
        <CardContent className="px-8 pb-8">
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <Label
                htmlFor="identifier"
                className="text-sm font-medium text-gray-700 mb-2 block"
              >
                Username or Email
              </Label>
              <Input
                id="identifier"
                type="text"
                value={loginData.identifier}
                onChange={(e) =>
                  setLoginData({ ...loginData, identifier: e.target.value })
                }
                required
                placeholder="Enter username or email"
                className="w-full h-12 px-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <Label
                htmlFor="password"
                className="text-sm font-medium text-gray-700 mb-2 block"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={loginData.password}
                onChange={(e) =>
                  setLoginData({ ...loginData, password: e.target.value })
                }
                required
                className="w-full h-12 px-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-white font-medium rounded-md transition-colors"
              style={{ backgroundColor: "#07376A" }}
              disabled={loading || authLoading}
            >
              {loading
                ? "Logging in..."
                : authLoading
                ? "Redirecting..."
                : "Login"}
            </Button>

            {/* Mobile App Download Link - Bottom */}
            {/* <div className="text-center pt-4 border-t">
              <p className="text-sm text-gray-600 mb-2">Prefer mobile?</p>
              <Link href="/download">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-blue-600 hover:text-blue-700 gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download Android App
                </Button>
              </Link>
            </div> */}
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;

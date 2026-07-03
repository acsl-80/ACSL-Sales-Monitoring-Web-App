
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "../contexts/useAuth";
import { Key, LogOut, CheckCircle } from "lucide-react";

const AuthenticationCard = () => {
  const { token, isAuthenticated, login, logout } = useAuth();
  const [inputToken, setInputToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!inputToken.trim()) return;

    setIsLoading(true);
    try {
      // For now, just accept any token. In a real app, you'd validate it
      login(inputToken.trim());
      setInputToken("");
      console.log("Authentication token set successfully");
    } catch (error) {
      console.error("Failed to set token:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) {
    return (
      <Card className="mb-6 border-green-200 bg-green-50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-900">Authenticated</p>
                <p className="text-sm text-green-700">
                  Token: ****{token.slice(-8)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="text-green-700 border-green-300 hover:bg-green-100"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-900">
          <Key className="h-5 w-5" />
          API Authentication Required
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="token" className="text-amber-900">
            Super Admin Token
          </Label>
          <div className="flex gap-2 mt-2">
            <Input
              id="token"
              type="password"
              placeholder="Enter your super admin token..."
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="flex-1"
              onKeyPress={(e) => e.key === "Enter" && handleLogin()}
            />
            <Button
              onClick={handleLogin}
              disabled={!inputToken.trim() || isLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isLoading ? "Setting..." : "Authenticate"}
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="text-xs">
            Required for API access
          </Badge>
          <Badge variant="outline" className="text-xs">
            Super admin only
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
};

export default AuthenticationCard;

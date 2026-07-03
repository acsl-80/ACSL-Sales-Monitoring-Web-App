
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LogOut, User, PanelLeft, Smartphone } from "lucide-react";
import { useAuth } from "../contexts/useAuth";
import { useRouter } from "@/compat/navigation";
import { useToastNotification } from "../contexts/useToastNotification";
import manageProfileService from "../services/manageProfileService";
import UserProfileModal from "./UserProfileModal";

// Module-level cache so we don't re-fetch /manage-profile on every layout
// mount or sidebar navigation. Keyed by user id.
const profileCache = new Map();
let inFlightProfilePromise = null;

const TopNavigation = ({
  onToggleSidebar,
  hideSidebarToggle,
  title,
  description,
  rightButton,
  user: authUser,
}) => {
  const { signOut, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const { toast } = useToastNotification();

  const userId = user?.id || authUser?.id || null;
  const [userProfile, setUserProfile] = useState(() =>
    userId ? profileCache.get(userId) || null : null,
  );
  const [loadingProfile, setLoadingProfile] = useState(
    () => !(userId && profileCache.has(userId)),
  );
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated || !userId) {
      setLoadingProfile(false);
      return;
    }

    if (profileCache.has(userId)) {
      setUserProfile(profileCache.get(userId));
      setLoadingProfile(false);
      return;
    }

    setLoadingProfile(true);
    const promise =
      inFlightProfilePromise || manageProfileService.getProfile();
    inFlightProfilePromise = promise;

    promise
      .then((response) => {
        if (response?.success && response.data) {
          profileCache.set(userId, response.data);
          if (!cancelled) setUserProfile(response.data);
        }
      })
      .catch((error) => console.error("Error fetching user profile:", error))
      .finally(() => {
        inFlightProfilePromise = null;
        if (!cancelled) setLoadingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  // Navigate to login when user becomes unauthenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    
    setIsLoggingOut(true);
    try {
      await signOut();
      toast.success("Success", "Logged out successfully");
      // Small delay to ensure auth state is properly cleared
      setTimeout(() => {
        window.location.href = "/login";
      }, 100);
    } catch (error) {
      console.error("Logout failed:", error);
      toast.error("Error", "Error logging out. Please try again.");
      window.location.href = "/login";
    } finally {
      setIsLoggingOut(false);
    }
  };

  const getWelcomeText = () => {
    if (loadingProfile) return "Loading...";
    if (userProfile?.profile?.full_name) return userProfile.profile.full_name;
    return authUser?.email?.split("@")[0] || "User";
  };

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 relative z-30 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!hideSidebarToggle && (
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-gray-100 flex-shrink-0"
              onClick={onToggleSidebar}
            >
              <PanelLeft className="h-5 w-5 text-gray-700" />
            </Button>
          )}
          <img 
            src="/logo.png" 
            alt="Atmosfair Logo" 
            className="h-[50px] sm:h-[65px] w-auto"
          />
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Optional right button */}
          {rightButton && <div className="hidden md:block">{rightButton}</div>}

          <Button
            variant="ghost"
            size="sm"
            asChild
            className="hidden sm:inline-flex items-center gap-2 text-gray-700 hover:bg-gray-50 shadow-none"
          >
            <a
              href="/downloads/sales-monitoring-app.apk"
              download="Atmosfair-Sales-Monitoring-App.apk"
            >
              <Smartphone className="h-4 w-4" />
              <span>Sales Monitoring App</span>
            </a>
          </Button>



          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 px-2 sm:px-3"
            onClick={() => setShowProfileModal(true)}
          >
            <User className="h-4 w-4" />
            <div className="hidden sm:flex flex-col items-start leading-tight">
              <span className="text-sm font-medium text-gray-700">
                {getWelcomeText()}
              </span>
            </div>

          </Button>

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 px-2 sm:px-3"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{isLoggingOut ? "Logging out..." : "Logout"}</span>
          </Button>
        </div>
      </div>

      {userProfile && (
        <UserProfileModal
          open={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          profileData={userProfile}
          onProfileUpdate={(updated) => {
            if (updated && userId) profileCache.set(userId, updated);
            if (updated) setUserProfile(updated);
          }}
        />
      )}
    </header>
  );
};

export default TopNavigation;

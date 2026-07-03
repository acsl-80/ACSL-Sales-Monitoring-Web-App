
import React, { useState, useEffect, createContext, useContext } from "react";
import { useAuth } from "../contexts/useAuth";
import { useRouter } from "@/compat/navigation";
import { useRouterState } from "@tanstack/react-router";
import { useSidebar } from "../contexts/useSidebar";
import Sidebar from "./Sidebar.jsx";
import TopNavigation from "./TopNavigation";
import FirstTimePasswordChangeModal from "./FirstTimePasswordChangeModal";
import profileService from "../services/profileService";

type DashboardLayoutProps = {
  children?: React.ReactNode;
  currentRoute?: string;
  title?: string;
  description?: string;
  rightButton?: React.ReactNode;
};

// Context flag: if a parent DashboardLayout is already mounted (e.g. the
// app-level shell in __root), nested usage renders children as a passthrough
// so the sidebar/topnav don't tear down on every navigation.
const LayoutMountedContext = createContext(false);

const deriveCurrentRouteFromPath = (pathname: string): string => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "dashboard";
  if (segments[0] === "settings" && segments[1]) return segments[1];
  if (segments[0] === "user-management" && segments[1] === "user-groups") {
    return "user-management-groups";
  }
  if (segments[0] === "user-management" && segments[1] === "users") {
    return "user-management-users";
  }
  if (segments[0] === "user-management") {
    return "user-management-users";
  }
  if (segments[0] === "sales" && segments[1] === "financial-reports") {
    return "sales-financial-reports";
  }
  if (segments[0] === "sales" && segments[1] === "create") {
    return "sales-create";
  }
  if (segments[0] === "partners" && segments[1] === "profiles") {
    return "partners-profiles";
  }
  if (segments[0] === "agents" && segments[1] === "profiles") {
    return "agents-profiles";
  }
  if (segments[0] === "agents" && segments[1] === "partner-agents-profiles") {
    return "partner-agents-profiles";
  }
  return segments[0];
};

const DashboardLayout = ({
  children,
  currentRoute,
  title = "Dashboard",
  description = "",
  rightButton = null,
}: DashboardLayoutProps) => {
  const alreadyMounted = useContext(LayoutMountedContext);

  if (alreadyMounted) {
    return <>{children}</>;
  }

  return (
    <LayoutMountedContext.Provider value={true}>
      <DashboardLayoutInner
        currentRoute={currentRoute}
        title={title}
        description={description}
        rightButton={rightButton}
      >
        {children}
      </DashboardLayoutInner>
    </LayoutMountedContext.Provider>
  );
};

const DashboardLayoutInner = ({
  children,
  currentRoute,
  title,
  description,
  rightButton,
}: DashboardLayoutProps) => {
  const { user, isSuperAdmin } = useAuth() as any;
  const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
  const [userProfile, setUserProfile] = useState<any>(null);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeRoute = currentRoute ?? deriveCurrentRouteFromPath(pathname);

  useEffect(() => {
    const loadProfile = async () => {
      const storedProfile = profileService.getStoredProfileData();
      if (storedProfile) {
        setUserProfile(storedProfile);
      }
    };
    if (user) {
      loadProfile();
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-white">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        currentRoute={activeRoute}
      />

      <div
        className={`flex flex-col min-h-screen transition-all duration-300 ease-in-out
          ${sidebarOpen ? "ml-0 lg:ml-64" : "ml-0 lg:ml-0"}`}
      >
        <TopNavigation
          onToggleSidebar={toggleSidebar}
          hideSidebarToggle={false}
          title={title}
          description={description}
          rightButton={null}
          user={user}
        />

        <main className="flex-1 overflow-y-auto bg-white">{children}</main>
      </div>

      {!isSuperAdmin && <FirstTimePasswordChangeModal userProfile={userProfile} />}
    </div>
  );
};

export default DashboardLayout;

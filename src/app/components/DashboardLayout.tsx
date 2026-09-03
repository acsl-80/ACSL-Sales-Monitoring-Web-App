
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

/**
 * The shell is mounted once, in __root, so the sidebar and top bar do not
 * tear down on every navigation. A page's own <DashboardLayout> is nested
 * inside it and used to render its children as a passthrough, which dropped
 * the title and the description on the floor: every page said "Dashboard" and
 * nothing ever reached the top bar (slice 8a, finding F26). The nested layout
 * now publishes what it was given to the shell, and takes it back on unmount.
 */
type PageMeta = { title?: string; description?: string };
type LayoutContextValue = { mounted: boolean; setMeta: (meta: PageMeta) => void };
const LayoutContext = createContext<LayoutContextValue>({ mounted: false, setMeta: () => {} });

const deriveCurrentRouteFromPath = (pathname: string): string => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "dashboard";
  // The Settings submenu's keys are "settings-<page>"; the derivation used to
  // return the bare page segment, so no Settings entry ever highlighted.
  if (segments[0] === "settings" && segments[1]) return `settings-${segments[1]}`;
  if (segments[0] === "payment-models") return "settings-payment-models";
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
  if (segments[0] === "sales" && segments[1] === "cancelled") {
    return "sales-cancelled";
  }
  if (segments[0] === "sales" && segments[1] === "cancelled-purchases") {
    return "sales-cancelled-purchases";
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
  if (segments[0] === "end-user-records" && segments[1] === "api") {
    return "docs";
  }
  return segments[0];
};

const DashboardLayout = ({
  children,
  currentRoute,
  title,
  description = "",
  rightButton = null,
}: DashboardLayoutProps) => {
  const shell = useContext(LayoutContext);
  const [meta, setMeta] = useState<PageMeta>({});

  // Nested inside the shell: hand it the page's words, and take them back when
  // this page goes, so the next page without a title shows none rather than
  // the last one's.
  useEffect(() => {
    if (!shell.mounted) return undefined;
    shell.setMeta({ title, description });
    return () => shell.setMeta({});
  }, [shell, title, description]);

  if (shell.mounted) {
    return <>{children}</>;
  }

  return (
    <LayoutContext.Provider value={{ mounted: true, setMeta }}>
      <DashboardLayoutInner
        currentRoute={currentRoute}
        title={meta.title ?? title}
        description={meta.description ?? description}
        rightButton={rightButton}
      >
        {children}
      </DashboardLayoutInner>
    </LayoutContext.Provider>
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
  // The path is the truth for what is highlighted; a page's own key is the
  // fallback for a path the derivation does not know.
  const activeRoute = deriveCurrentRouteFromPath(pathname) ?? currentRoute;

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

        <main className="flex-1 bg-white">{children}</main>
      </div>

      {!isSuperAdmin && <FirstTimePasswordChangeModal userProfile={userProfile} />}
    </div>
  );
};

export default DashboardLayout;

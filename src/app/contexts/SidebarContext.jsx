
import { useState, useEffect } from "react";
import { SidebarContext } from "./useSidebar";

export const SidebarProvider = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Set sidebar open by default on desktop
  useEffect(() => {
    const handleResize = () => {
      const isDesktop = window.innerWidth >= 1024;
      setSidebarOpen((prev) => {
        if (isDesktop && !prev) return true;
        if (!isDesktop && prev) return false;
        return prev;
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  const closeSidebar = () => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const forceCloseSidebar = () => {
    setSidebarOpen(false);
  };

  return (
    <SidebarContext.Provider
      value={{
        sidebarOpen,
        toggleSidebar,
        closeSidebar,
        forceCloseSidebar,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

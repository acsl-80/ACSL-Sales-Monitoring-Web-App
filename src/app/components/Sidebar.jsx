
import { useState } from "react";
import { useRouter } from "@/compat/navigation";
import { useAuth } from "../contexts/useAuth";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart,
  X,
  Users,
  Settings,
  LayoutDashboard,
  FileImage,
  Key,
  User,
  UserCheck,
  Package,
  Tag,
  Layers,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Smartphone,
  Map,
  CreditCard,
  Wrench,
  ShieldCheck,
  FileText,
  BarChart3,
} from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import Link from "@/compat/Link";

// Single canonical nav. Visibility is driven entirely by permissions —
// super_admin sees everything because usePermissions short-circuits to true.
const allNavItems = [
  { name: "Dashboard", icon: LayoutDashboard, route: "dashboard", href: "/dashboard" },
  {
    name: "User Management",
    icon: ShieldCheck,
    route: "user-management",
    children: [
      { name: "User Manager", route: "user-management-users", href: "/user-management/users" },
      { name: "User Groups", route: "user-management-groups", href: "/user-management/user-groups" },
    ],
  },
  {
    name: "Partner Management",
    icon: UserCheck,
    route: "partners-profiles",
    href: "/partners/profiles",
  },
  {
    name: "Agent Management",
    icon: Users,
    route: "agents",
    children: [
      { name: "ACSL Agents Profile", route: "agents-profiles", href: "/agents/profiles" },
      { name: "Partner Agents Profile", route: "partner-agents-profiles", href: "/agents/partner-agents-profiles" },
    ],
  },
  { name: "Performance Report", icon: BarChart3, route: "performance-report", href: "/agents" },
  {
    name: "Manage Sales",
    icon: ShoppingCart,
    route: "sales",
    children: [
      { name: "Sell Stove", route: "sales-create", href: "/sales/create" },
      { name: "Sales Records", route: "sales", href: "/sales" },
      { name: "Cancelled Transactions", route: "sales-cancelled", href: "/sales/cancelled" },
      { name: "Cancelled Purchases", route: "sales-cancelled-purchases", href: "/sales/cancelled-purchases" },
      { name: "Purchases from ACSL", route: "stove-transfer-history", href: "/stove-transfer-history" },
      { name: "Agreement Images", route: "agreement-images", href: "/agreement-images" },
      { name: "Map", route: "map", href: "/map" },
    ],
  },

  { name: "Stove Users Data", icon: FileText, route: "end-user-records", href: "/end-user-records" },

  { name: "Track Stoves", icon: Tag, route: "stove-management", href: "/stove-management" },
  {
    name: "Settings",
    icon: Settings,
    route: "settings",
    children: [
      { name: "Payment Models", route: "settings-payment-models", href: "/payment-models" },
      { name: "Credentials", route: "settings-credentials", href: "/settings/credentials" },
      { name: "System Configuration", route: "settings-system-config", href: "/settings/system-config" },
      { name: "Tools", route: "settings-tools", href: "/settings/tools" },
    ],
  },
  // { name: "Profile", icon: User, route: "profile", href: "/profile" },
];

const Sidebar = ({ isOpen, onClose, currentRoute }) => {
  const router = useRouter();
  const { isAcslAgent, isAcslAgentManager } = useAuth();
  const { canRoute } = usePermissions();

  const [expandedItems, setExpandedItems] = useState({});

  const toggleExpand = (key) => {
    setExpandedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Build nav from permissions; for items with children, also filter children
  // and drop the parent if no children are visible.
  const navItems = allNavItems
    .map((item) => {
      if (item.children) {
        const visibleChildren = item.children.filter((c) => canRoute(c.route));
        if (visibleChildren.length === 0) return null;
        return { ...item, children: visibleChildren };
      }
      return canRoute(item.route) ? item : null;
    })
    .filter(Boolean)
    .map((item) => {
      if (item.route === "partners" && (isAcslAgent || isAcslAgentManager)) {
        return { ...item, name: "My Partners" };
      }
      return item;
    });

  const navigateToRoute = (href) => {
    router.push(href);
    if (typeof window !== "undefined" && window.innerWidth < 1024) onClose();
  };

  const handleOverlayClick = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) onClose();
  };

  const isChildActive = (children) =>
    children?.some((child) => currentRoute === child.route);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300 ease-in-out"
          onClick={handleOverlayClick}
        />
      )}

      <div
        className={`fixed top-0 left-0 h-screen z-50 w-64 border-r border-gray-200 flex flex-col
          transition-all duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: "#fafafa" }}
      >
        <div className="p-4">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-600" />
            <h2 className="font-bold text-lg" style={{ color: "#4a5d0f" }}>
              CONTROL PANEL
            </h2>

          </div>
        </div>

        <button
          className="lg:hidden absolute top-4 right-4 p-2 text-gray-600 hover:bg-white/50 rounded-lg transition-colors"
          onClick={handleOverlayClick}
        >
          <X className="h-5 w-5" />
        </button>

        <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto min-h-0">
          {navItems.map((item) => {
            if (item.children) {
              const childActive = isChildActive(item.children);
              const isExpanded =
                expandedItems[item.route] !== undefined
                  ? expandedItems[item.route]
                  : childActive;

              return (
                <div key={item.route}>
                  <button
                    onClick={() => toggleExpand(item.route)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm w-full text-left ${
                      childActive
                        ? "bg-[#4a5d0f] text-white font-medium hover:bg-[#4a5d0f]"
                        : "text-gray-700 hover:bg-[#4a5d0f] hover:text-white"
                    }`}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    <span className="flex-1">{item.name}</span>
                    {isExpanded ? (
                      <ChevronUp className={`h-4 w-4 ${childActive ? "text-white/80" : "text-gray-400"}`} />

                    ) : (
                      <ChevronDown className={`h-4 w-4 ${childActive ? "text-white/80" : "text-gray-400"}`} />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="ml-4 pl-4 border-l border-gray-200 space-y-0.5 mt-0.5">
                      {item.children.map((child) => {
                        const active = currentRoute === child.route;
                        return (
                          <Link
                            key={child.route}
                            href={child.href}
                            onClick={() => navigateToRoute(child.href)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
                              active
                                ? "bg-[#eef3c4] text-[#4a5d0f] font-medium hover:bg-[#eef3c4]"
                                : "text-gray-600 hover:bg-[#eef3c4] hover:text-[#4a5d0f]"

                            }`}
                          >
                            <span>{child.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const active = currentRoute === item.route;
            return (
              <Link
                key={item.route}
                href={item.href}
                onClick={() => navigateToRoute(item.href)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                  active
                    ? "bg-[#4a5d0f] text-white font-medium hover:bg-[#4a5d0f]"
                    : "text-gray-700 hover:bg-[#4a5d0f] hover:text-white"

                }`}
              >
                <item.icon className="h-[18px] w-[18px]" />
                <span className="flex-1">{item.name}</span>
                {item.badge && (
                  <Badge variant="secondary" className="text-xs px-2 py-1">
                    {item.badge}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

      </div>
    </>
  );
};

export default Sidebar;

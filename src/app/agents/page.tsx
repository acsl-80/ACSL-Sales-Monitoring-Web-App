import { useState, useMemo, useEffect } from "react";
import ProtectedRoute from "../components/ProtectedRoute";
import { usePermissions } from "../hooks/usePermissions";
import SuperAdminAgentsContent from "./components/SuperAdminAgentsContent";
import PartnersContent from "../partners/components/PartnersContent";
import { Users, Building2 } from "lucide-react";

type TabKey = "agents" | "partners";

function PerformanceTabs() {
  const { can } = usePermissions();
  // ACSL Agents tab: super_admin (full) + acsl_agent_manager (scoped) only —
  // per the RBAC matrix it is hidden for acsl_agent and partner.
  const showAgents = can("manage-acsl-agents") || can("manage-acsl-agents-scoped");

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; icon: typeof Users }[] = [];
    if (showAgents) list.push({ key: "agents", label: "ACSL Agents Performance Report", icon: Users });
    list.push({ key: "partners", label: "Partners Performance Report", icon: Building2 });
    return list;
  }, [showAgents]);

  const [active, setActive] = useState<TabKey>(() => tabs[0]?.key ?? "agents");

  useEffect(() => {
    if (tabs.length && !tabs.find((t) => t.key === active)) {
      setActive(tabs[0].key);
    }
  }, [tabs, active]);

  return (
    <div className="space-y-2">
      {/* Beautiful segmented tab control */}
      <div className="px-6 pt-6">
        <div
          role="tablist"
          aria-label="Performance Report"
          className="flex w-full items-center gap-1 rounded-xl border border-[#e5e7eb] bg-white p-1 shadow-sm"
        >
          {tabs.map((t) => {
            const isActive = active === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(t.key)}
                className={[
                  "relative flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-[#4a5d0f] text-white shadow-[0_2px_8px_rgba(74,93,15,0.35)]"
                    : "text-[#4a5d0f] hover:bg-[#eef3c4]",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel">
        {active === "agents" && showAgents ? (
          <SuperAdminAgentsContent />
        ) : (
          <PartnersContent />
        )}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <ProtectedRoute requireAdminAccess routeKey="agents">
      <PerformanceTabs />
    </ProtectedRoute>
  );
}


import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertCircle, Building2, MapPin, Package, TrendingUp } from "lucide-react";
import superAdminAgentService from "../../services/superAdminAgentService";

interface Agent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  created_at: string;
  assigned_organizations_count: number;
  assigned_states_count: number;
}

interface AssignedOrg {
  id: string;
  partner_name: string;
  branch: string | null;
  state: string | null;
  source?: string;
  assigned_at: string;
}

interface ViewSuperAdminAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

const DetailItem = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div className="space-y-0.5">
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
      {label}
    </p>
    <p className="text-xs font-medium text-gray-900 overflow-hidden text-ellipsis">
      {value ?? <span className="text-gray-400">N/A</span>}
    </p>
  </div>
);

const SectionCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-1 mb-2.5">
      {title}
    </h3>
    {children}
  </div>
);

interface PerformanceMetrics {
  totalPartners: number;
  totalStoves: number;
  salesMade: number;
  pendingSales: number;
  statesCount: number;
}

const ViewSuperAdminAgentModal: React.FC<ViewSuperAdminAgentModalProps> = ({
  agent,
  onClose,
}) => {
  const [orgs, setOrgs] = useState<AssignedOrg[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState("");
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);

  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        setOrgsLoading(true);
        setOrgsError("");
        const result = await superAdminAgentService.getAgentOrganizations(agent.id);
        const orgData: any[] = result.data || [];
        setOrgs(orgData);

        // Compute performance metrics from org data
        setMetrics({
          totalPartners: orgData.length,
          totalStoves: orgData.reduce((s: number, o: any) => s + (o.total_sales ?? 0), 0),
          salesMade: orgData.reduce((s: number, o: any) => s + (o.approved_sales ?? 0), 0),
          pendingSales: orgData.reduce((s: number, o: any) => s + (o.pending_sales ?? 0), 0),
          statesCount: (result.assigned_states || []).length,
        });
      } catch (err: any) {
        setOrgsError(err.message || "Failed to load organizations");
      } finally {
        setOrgsLoading(false);
      }
    };
    fetchOrgs();
  }, [agent.id]);

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const directOrgs = orgs.filter((o) => !o.source || o.source === "direct");
  const stateOrgs = orgs.filter((o) => o.source === "state");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-[#07376a] w-9 h-9 rounded-full flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-sm">
                  {agent.full_name?.charAt(0)?.toUpperCase() || "A"}
                </span>
              </div>
              <div>
                <DialogTitle className="text-sm font-bold text-foreground">
                  {agent.full_name}
                </DialogTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {agent.email}
                </p>
              </div>
            </div>
            <span
              className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${
                agent.status === "active"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-600 border-red-200"
              }`}
            >
              {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
            </span>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto space-y-3 p-5">
          {/* Performance Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              {
                label: "Partners",
                value: orgsLoading ? "—" : (metrics?.totalPartners ?? 0),
                icon: Building2,
                bg: "bg-green-50",
                border: "border-green-100",
                text: "text-green-700",
              },
              {
                label: "States Covered",
                value: orgsLoading ? "—" : (metrics?.statesCount ?? agent.assigned_states_count ?? 0),
                icon: MapPin,
                bg: "bg-purple-50",
                border: "border-purple-100",
                text: "text-purple-700",
              },
              {
                label: "Stoves Assigned",
                value: orgsLoading ? "—" : (metrics?.totalStoves ?? 0).toLocaleString(),
                icon: Package,
                bg: "bg-blue-50",
                border: "border-blue-100",
                text: "text-blue-700",
              },
              {
                label: "Sales Made",
                value: orgsLoading ? "—" : (metrics?.salesMade ?? 0),
                icon: TrendingUp,
                bg: "bg-amber-50",
                border: "border-amber-100",
                text: "text-amber-700",
              },
            ].map(({ label, value, icon: Icon, bg, border, text }) => (
              <div key={label} className={`${bg} ${border} border rounded-lg px-3 py-2.5 flex items-center gap-2.5`}>
                <Icon className={`h-4 w-4 ${text} shrink-0`} />
                <div>
                  <p className={`text-sm font-bold ${text}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Agent Information */}
          <SectionCard title="Agent Information">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DetailItem label="Full Name" value={agent.full_name} />
              <DetailItem label="Email" value={agent.email} />
              <DetailItem label="Phone" value={agent.phone || "—"} />
              <DetailItem
                label="Role"
                value={
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    agent.role === "acsl_agent_manager"
                      ? "bg-blue-100 text-blue-700"
                      : agent.role === "super_admin"
                      ? "bg-red-100 text-red-700"
                      : "bg-purple-100 text-purple-700"
                  }`}>
                    {agent.role === "acsl_agent_manager"
                      ? "ACSL Agent Manager"
                      : agent.role === "super_admin"
                      ? "Super Admin"
                      : "ACSL Agent"}
                  </span>
                }
              />
              <DetailItem label="Date Joined" value={formatDate(agent.created_at)} />
              <DetailItem
                label="Partners Assigned"
                value={
                  <span className="flex items-center gap-1">
                    <span className="bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                      {agent.assigned_organizations_count ?? 0} partners
                    </span>
                    {(agent.assigned_states_count ?? 0) > 0 && (
                      <span className="bg-purple-100 text-purple-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                        {agent.assigned_states_count} state{agent.assigned_states_count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                }
              />
            </div>
          </SectionCard>

          {/* Assigned Partners */}
          <SectionCard title={`Assigned Partners${!orgsLoading ? ` (${orgs.length})` : ""}`}>
            {orgsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            ) : orgsError ? (
              <div className="flex items-center gap-2 px-2.5 py-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-700">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {orgsError}
              </div>
            ) : orgs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-4 text-center">
                No partners assigned yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#07376a] text-white">
                      <th className="text-left px-2.5 py-1.5 font-semibold text-[11px]">Partner Name</th>
                      <th className="text-left px-2.5 py-1.5 font-semibold text-[11px]">State</th>
                      <th className="text-left px-2.5 py-1.5 font-semibold text-[11px]">Branch</th>
                      {/* <th className="text-left px-2.5 py-1.5 font-semibold text-[11px]">Assignment</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map((org, idx) => (
                      <tr
                        key={org.id}
                        className={idx % 2 === 0 ? "bg-white" : "bg-blue-50/40"}
                      >
                        <td className="px-2.5 py-1.5 font-medium text-gray-900">
                          {org.partner_name}
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-600">
                          {org.state || "—"}
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-600">
                          {org.branch || "—"}
                        </td>
                        {/* <td className="px-2.5 py-1.5">
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              org.source === "state"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {org.source === "state" ? "Via State" : "Direct"}
                          </span>
                        </td> */}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ViewSuperAdminAgentModal;

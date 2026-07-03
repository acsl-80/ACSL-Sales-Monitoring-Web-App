
import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  Save,
  Loader2,
  Search,
  X,
  Building2,
  Check,
  MapPin,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import superAdminAgentService from "../../services/superAdminAgentService";
import organizationsService from "../../services/organizationsService";
import { lgaAndStates } from "../../constants";
import { useAuth } from "../../contexts/useAuth";

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

interface Organization {
  id: string;
  partner_name: string;
  branch: string | null;
  state: string | null;
}

interface AssignOrganizationsModalProps {
  agent: Agent;
  onClose: () => void;
  onSuccess: () => void;
}

const ALL_STATES = Object.keys(lgaAndStates).sort();

const AssignOrganizationsModal: React.FC<AssignOrganizationsModalProps> = ({
  agent,
  onClose,
  onSuccess,
}) => {
  const { userRole, user } = useAuth();
  const isCallerManager = userRole === "acsl_agent_manager";

  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [selectedDirectOrgIds, setSelectedDirectOrgIds] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [stateSearchTerm, setStateSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statesExpanded, setStatesExpanded] = useState(true);
  const [orgsExpanded, setOrgsExpanded] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError("");

        const [orgsResult, assignedResult, statesResult] = await Promise.all([
          // Managers only see their own assigned orgs; super admin sees all
          isCallerManager && user?.id
            ? superAdminAgentService.getAgentOrganizations(user.id)
            : organizationsService.getAllOrganizations(),
          superAdminAgentService.getAgentOrganizations(agent.id),
          superAdminAgentService.getAgentStates(agent.id),
        ]);

        setAllOrgs(orgsResult.data || []);

        // Direct org assignments only (exclude state-resolved ones)
        const directOrgs = (assignedResult.data || []).filter(
          (o: any) => !o.source || o.source === "direct"
        );
        setSelectedDirectOrgIds(new Set(directOrgs.map((o: any) => o.id as string)));

        // State assignments
        const states = (statesResult.data || []).map((s: any) => s.state as string);
        setSelectedStates(new Set(states));
      } catch (err: any) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [agent.id, isCallerManager, user?.id]);

  // Count orgs per state
  const orgCountByState = useMemo(() => {
    const counts: Record<string, number> = {};
    allOrgs.forEach((org) => {
      if (org.state) {
        counts[org.state] = (counts[org.state] || 0) + 1;
      }
    });
    return counts;
  }, [allOrgs]);

  // Org IDs covered by selected states
  const stateCoveredOrgIds = useMemo(() => {
    const ids = new Set<string>();
    allOrgs.forEach((org) => {
      if (org.state && selectedStates.has(org.state)) {
        ids.add(org.id);
      }
    });
    return ids;
  }, [allOrgs, selectedStates]);

  // Total unique org count
  const totalUniqueOrgs = useMemo(() => {
    const allIds = new Set([...selectedDirectOrgIds, ...stateCoveredOrgIds]);
    return allIds.size;
  }, [selectedDirectOrgIds, stateCoveredOrgIds]);

  // Managers can only assign from their own states; super admin sees all
  const managerStates = useMemo(
    () => [...new Set(allOrgs.map((o) => o.state).filter(Boolean) as string[])].sort(),
    [allOrgs]
  );
  const availableStates = isCallerManager ? managerStates : ALL_STATES;
  const filteredStates = availableStates.filter((s) =>
    s.toLowerCase().includes(stateSearchTerm.toLowerCase())
  );

  const filteredOrgs = allOrgs.filter((org) => {
    const q = searchTerm.toLowerCase();
    return (
      org.partner_name.toLowerCase().includes(q) ||
      (org.branch || "").toLowerCase().includes(q) ||
      (org.state || "").toLowerCase().includes(q)
    );
  });

  const toggleState = (state: string) => {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  };

  const toggleOrg = (orgId: string) => {
    setSelectedDirectOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      await Promise.all([
        superAdminAgentService.setAgentStates(agent.id, Array.from(selectedStates)),
        superAdminAgentService.setAgentOrganizations(agent.id, Array.from(selectedDirectOrgIds)),
      ]);
      // Notify other views (Partner Profiles, Agents Profile) to refresh
      // their cached assignment counts.
      try {
        window.dispatchEvent(new CustomEvent("acsl:assignment-updated", { detail: { agentId: agent.id } }));
        window.dispatchEvent(new CustomEvent("acsl:user-updated", { detail: { agentId: agent.id } }));
      } catch { /* non-fatal */ }
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to save assignments");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Assign to Partners & States
          </DialogTitle>
          <DialogDescription>
            Assign states and/or specific organizations that{" "}
            <span className="font-medium">{agent.full_name}</span> can monitor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 flex-shrink-0">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          {/* Summary */}
          <div className="flex items-center justify-between flex-shrink-0">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-brand">{selectedStates.size}</span>{" "}
              state{selectedStates.size !== 1 ? "s" : ""}
              {stateCoveredOrgIds.size > 0 && (
                <span className="text-gray-400">
                  {" "}({stateCoveredOrgIds.size} orgs)
                </span>
              )}
              {" · "}
              <span className="font-medium text-brand">{selectedDirectOrgIds.size}</span>{" "}
              direct org{selectedDirectOrgIds.size !== 1 ? "s" : ""}
              {" = "}
              <span className="font-semibold text-gray-900">{totalUniqueOrgs}</span> total
            </p>
            {(selectedStates.size > 0 || selectedDirectOrgIds.size > 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedStates(new Set());
                  setSelectedDirectOrgIds(new Set());
                }}
                className="text-gray-500 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <span className="ml-2 text-sm text-gray-600">Loading...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
              {/* ── States Section ── */}
              <div className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => setStatesExpanded(!statesExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <MapPin className="h-4 w-4 text-brand" />
                    States
                    {selectedStates.size > 0 && (
                      <Badge className="bg-brand/10 text-brand border-brand/20 text-xs">
                        {selectedStates.size} selected
                      </Badge>
                    )}
                  </span>
                  {statesExpanded ? (
                    <ChevronUp className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  )}
                </button>

                {statesExpanded && (
                  <div className="p-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <Input
                        placeholder="Search states..."
                        value={stateSearchTerm}
                        onChange={(e) => setStateSearchTerm(e.target.value)}
                        className="pl-9 h-8 text-sm"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto grid grid-cols-2 gap-1">
                      {filteredStates.map((state) => {
                        const isSelected = selectedStates.has(state);
                        const count = orgCountByState[state] || 0;
                        return (
                          <button
                            key={state}
                            type="button"
                            onClick={() => toggleState(state)}
                            className={`flex items-center gap-2 px-3 py-2 rounded text-left text-sm transition-colors ${
                              isSelected
                                ? "bg-blue-50 hover:bg-blue-100"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            <div
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                isSelected
                                  ? "bg-brand border-brand"
                                  : "border-gray-300"
                              }`}
                            >
                              {isSelected && (
                                <Check className="h-2.5 w-2.5 text-white" />
                              )}
                            </div>
                            <span className="truncate flex-1">{state}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Direct Organizations Section ── */}
              <div className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => setOrgsExpanded(!orgsExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <Building2 className="h-4 w-4 text-brand" />
                    Direct Organizations
                    {selectedDirectOrgIds.size > 0 && (
                      <Badge className="bg-brand/10 text-brand border-brand/20 text-xs">
                        {selectedDirectOrgIds.size} selected
                      </Badge>
                    )}
                  </span>
                  {orgsExpanded ? (
                    <ChevronUp className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  )}
                </button>

                {orgsExpanded && (
                  <div className="p-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <Input
                        placeholder="Search organizations..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 h-8 text-sm"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y">
                      {filteredOrgs.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-6">
                          {searchTerm
                            ? "No organizations match your search."
                            : "No organizations found."}
                        </p>
                      ) : (
                        filteredOrgs.map((org) => {
                          const isCoveredByState = stateCoveredOrgIds.has(org.id);
                          const isDirectSelected = selectedDirectOrgIds.has(org.id);

                          return (
                            <button
                              key={org.id}
                              type="button"
                              onClick={() => {
                                if (!isCoveredByState) toggleOrg(org.id);
                              }}
                              disabled={isCoveredByState}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                isCoveredByState
                                  ? "bg-green-50 opacity-70 cursor-default"
                                  : isDirectSelected
                                  ? "bg-blue-50 hover:bg-blue-100"
                                  : "bg-white hover:bg-gray-50"
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                  isCoveredByState
                                    ? "bg-green-500 border-green-500"
                                    : isDirectSelected
                                    ? "bg-brand border-brand"
                                    : "border-gray-300"
                                }`}
                              >
                                {(isCoveredByState || isDirectSelected) && (
                                  <Check className="h-2.5 w-2.5 text-white" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 text-sm truncate">
                                  {org.partner_name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {[org.branch, org.state]
                                    .filter(Boolean)
                                    .join(" · ") || "No branch/state info"}
                                </p>
                              </div>
                              {isCoveredByState && (
                                <Badge className="bg-green-100 text-green-700 border-green-200 text-xs flex-shrink-0">
                                  via {org.state}
                                </Badge>
                              )}
                              {isDirectSelected && !isCoveredByState && (
                                <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs flex-shrink-0">
                                  Direct
                                </Badge>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-2 flex-shrink-0 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-brand hover:bg-brand-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Assignments
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AssignOrganizationsModal;

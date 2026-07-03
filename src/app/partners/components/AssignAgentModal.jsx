
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Users, UserCheck, AlertCircle } from "lucide-react";
import superAdminAgentService from "../../services/superAdminAgentService";
import { useToast } from "@/components/ui/toast";

export default function AssignAgentModal({ organization, isOpen, onClose, onSuccess }) {
  const { toast } = useToast();
  const [agents, setAgents] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [originalIds, setOriginalIds] = useState(new Set());
  const [loadingInit, setLoadingInit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && organization) loadData();
  }, [isOpen, organization]);

  const loadData = async () => {
    setLoadingInit(true);
    setError(null);
    setSearch("");
    try {
      const agentsResult = await superAdminAgentService.getSuperAdminAgents({ limit: 200 });
      const allAgents = agentsResult.data || [];
      setAgents(allAgents);

      // Check which agents are directly assigned to this org
      const assignedIds = new Set();
      await Promise.all(
        allAgents.map(async (agent) => {
          try {
            const result = await superAdminAgentService.getAgentOrganizations(agent.id);
            const directOrgs = (result.data || []).filter(
              (o) => !o.source || o.source === "direct"
            );
            if (directOrgs.some((o) => o.id === organization.id)) {
              assignedIds.add(agent.id);
            }
          } catch {
            // ignore per-agent errors silently
          }
        })
      );
      setSelectedIds(new Set(assignedIds));
      setOriginalIds(new Set(assignedIds));
    } catch (err) {
      setError(err.message || "Failed to load agents");
    } finally {
      setLoadingInit(false);
    }
  };

  const toggleAgent = (agentId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const toAdd = [...selectedIds].filter((id) => !originalIds.has(id));
      const toRemove = [...originalIds].filter((id) => !selectedIds.has(id));

      // Remove via single-remove endpoint
      await Promise.all(
        toRemove.map((agentId) =>
          superAdminAgentService.removeAgentOrganization(agentId, organization.id)
        )
      );

      // Add: fetch current direct orgs, append this org, full-replace
      await Promise.all(
        toAdd.map(async (agentId) => {
          const result = await superAdminAgentService.getAgentOrganizations(agentId);
          const currentDirectIds = (result.data || [])
            .filter((o) => !o.source || o.source === "direct")
            .map((o) => o.id);
          if (!currentDirectIds.includes(organization.id)) {
            await superAdminAgentService.setAgentOrganizations(agentId, [
              ...currentDirectIds,
              organization.id,
            ]);
          }
        })
      );

      toast({ variant: "success", title: "Agent assignments updated successfully" });
      onSuccess?.();
      onClose();
    } catch (err) {
      toast({ variant: "error", title: "Failed to save assignments", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const filtered = agents.filter(
    (a) =>
      !search ||
      a.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.email?.toLowerCase().includes(search.toLowerCase())
  );

  const hasChanges =
    [...selectedIds].some((id) => !originalIds.has(id)) ||
    [...originalIds].some((id) => !selectedIds.has(id));

  // Business rule: agents that would lose their last assignment
  const agentsLosingLastOrg = agents.filter(
    (agent) =>
      originalIds.has(agent.id) &&
      !selectedIds.has(agent.id) &&
      (agent.assigned_organizations_count ?? 0) <= 1 &&
      (agent.assigned_states_count ?? 0) === 0
  );

  const blockSave = agentsLosingLastOrg.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
          <DialogTitle className="text-base font-bold">Assign Agents</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {organization?.partner_name} — select ACSL agents to assign to this partner
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
            </div>
          )}

          {agentsLosingLastOrg.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-800 font-medium text-xs">Cannot remove — business rule violation</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  {agentsLosingLastOrg.map((a) => a.full_name).join(", ")}{" "}
                  {agentsLosingLastOrg.length === 1 ? "has" : "have"} no other partner assignments.
                  Agents must belong to at least one partner.
                </p>
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="Search agents by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-white"
            />
          </div>

          {loadingInit ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <p className="text-xs text-gray-500">Loading agents & current assignments...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              {search ? "No agents match your search." : "No ACSL agents found."}
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 font-medium">
                {selectedIds.size} agent{selectedIds.size !== 1 ? "s" : ""} assigned to this partner
              </p>
              {filtered.map((agent) => {
                const isSelected = selectedIds.has(agent.id);
                const willViolate = agentsLosingLastOrg.some((a) => a.id === agent.id);
                return (
                  <button
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                      willViolate
                        ? "border-amber-400 bg-amber-50"
                        : isSelected
                        ? "border-[#07376a] bg-[#07376a]/5"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center font-bold text-[11px] flex-shrink-0 ${
                        isSelected ? "bg-[#07376a] text-white" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {agent.full_name?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{agent.full_name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{agent.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {agent.status !== "active" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                          Disabled
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">
                        {(agent.assigned_organizations_count ?? 0)} org
                        {(agent.assigned_organizations_count ?? 0) !== 1 ? "s" : ""}
                        {(agent.assigned_states_count ?? 0) > 0 &&
                          ` · ${agent.assigned_states_count} state${agent.assigned_states_count !== 1 ? "s" : ""}`}
                      </span>
                      {isSelected && <UserCheck className="h-4 w-4 text-[#07376a]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3 flex items-center justify-between bg-gray-50 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#07376a] hover:bg-[#07376a]/90 text-white"
            onClick={handleSave}
            disabled={saving || loadingInit || !hasChanges || blockSave}
          >
            {saving ? (
              <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Saving...</>
            ) : (
              "Save Assignments"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

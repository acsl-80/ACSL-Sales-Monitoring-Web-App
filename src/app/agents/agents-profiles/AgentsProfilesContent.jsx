import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  X,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import PageHeader from "../../components/PageHeader";
import superAdminAgentService from "../../services/superAdminAgentService";
import { createClientComponentClient } from "@/lib/supabaseClient";
import { useToast, ToastContainer } from "@/components/ui/toast";
import ViewSuperAdminAgentModal from "../../super-admin-agents/components/ViewSuperAdminAgentModal";
import EditSuperAdminAgentModal from "../../super-admin-agents/components/EditSuperAdminAgentModal";
import AssignOrganizationsModal from "../../super-admin-agents/components/AssignOrganizationsModal";
import AgentViewCredentialModal from "../../admin/components/agents/AgentViewCredentialModal";
import tokenManager from "@/utils/tokenManager";
import { useAuth } from "../../contexts/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MapPin, Building2, Search } from "lucide-react";

const PAGE_SIZE = 10;

// Direct-assignment table for ACSL Agents → Organizations.
// Try the canonical agent column first, fall back to alternates once.
const ASSIGNMENT_TABLE = "super_admin_agent_organizations";
const AGENT_COLUMN_CANDIDATES = ["agent_id", "super_admin_agent_id", "user_id"];
let resolvedAgentColumn = null;

async function resolveAgentColumn(supabase) {
  if (resolvedAgentColumn) return resolvedAgentColumn;
  for (const col of AGENT_COLUMN_CANDIDATES) {
    const { error } = await supabase
      .from(ASSIGNMENT_TABLE)
      .select(col, { count: "exact", head: true })
      .limit(1);
    if (!error) {
      resolvedAgentColumn = col;
      return col;
    }
  }
  return null;
}

async function fetchDirectPartnerCount(supabase, agentId) {
  const col = await resolveAgentColumn(supabase);
  if (!col) return null;
  const { count, error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .select("organization_id", { count: "exact", head: true })
    .eq(col, agentId);
  if (error) return null;
  return count ?? 0;
}

async function fetchDirectPartnerList(supabase, agentId) {
  const col = await resolveAgentColumn(supabase);
  if (!col) return null;
  const { data, error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .select("organization_id, organizations(id, partner_name, state, branch)")
    .eq(col, agentId);
  if (error) return null;
  return (data || [])
    .map((row) => row.organizations)
    .filter(Boolean);
}

async function fetchDirectPartnerAssignmentRows(supabase, agentId) {
  const col = await resolveAgentColumn(supabase);
  if (!col) return null;
  const { data, error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .select("organization_id, assigned_by, organizations(id, partner_name, state, branch)")
    .eq(col, agentId);
  if (error) return null;
  return Array.isArray(data) ? data : [];
}

function inferSupervisorsForAgent(agentOrgIds, managerInfo, assignmentRows = []) {
  if (agentOrgIds.size === 0 || managerInfo.length === 0) return [];

  const assignedByManagers = new Set(
    assignmentRows
      .map((row) => row?.assigned_by)
      .filter((id) => managerInfo.some((m) => m.id === id))
  );
  if (assignedByManagers.size > 0) {
    return managerInfo
      .filter((m) => assignedByManagers.has(m.id))
      .map((m) => m.name);
  }

  const candidates = managerInfo
    .map((m) => {
      let overlap = 0;
      for (const id of agentOrgIds) if (m.orgIds.has(id)) overlap += 1;
      return {
        ...m,
        overlap,
        coversAll: overlap === agentOrgIds.size,
        extraPartners: Math.max(0, m.orgIds.size - agentOrgIds.size),
      };
    })
    .filter((m) => m.overlap > 0);

  const fullCover = candidates
    .filter((m) => m.coversAll)
    .sort((a, b) => a.extraPartners - b.extraPartners || a.name.localeCompare(b.name));
  if (fullCover.length > 0) return [fullCover[0].name];

  // If older records do not have assigned_by, show only the single closest
  // manager instead of listing every manager with a partial partner overlap.
  // This prevents an agent assigned to one supervisor from appearing under many.
  candidates.sort((a, b) => b.overlap - a.overlap || a.extraPartners - b.extraPartners || a.name.localeCompare(b.name));
  return candidates.length > 0 ? [candidates[0].name] : [];
}

const AgentsProfilesContent = () => {
  const { toast, toasts, removeToast } = useToast();
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();

  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClientComponentClient();
  const isMountedRef = useRef(true);
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "", role: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [detailsAgent, setDetailsAgent] = useState(null);
  const [editingAgent, setEditingAgent] = useState(null);
  const [assignAgent, setAssignAgent] = useState(null);
  const [credentialAgent, setCredentialAgent] = useState(null);
  const [credentialData, setCredentialData] = useState(null);
  const [loadingCredentialId, setLoadingCredentialId] = useState(null);

  const [statesModalAgent, setStatesModalAgent] = useState(null);
  const [statesModalList, setStatesModalList] = useState([]);
  const [statesModalLoading, setStatesModalLoading] = useState(false);

  const [partnersModalAgent, setPartnersModalAgent] = useState(null);
  const [partnersModalList, setPartnersModalList] = useState([]);
  const [partnersModalLoading, setPartnersModalLoading] = useState(false);
  const [statesSearch, setStatesSearch] = useState("");
  const [partnersSearch, setPartnersSearch] = useState("");

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const openStatesModal = async (agent) => {
    setStatesModalAgent(agent);
    setStatesModalList([]);
    setStatesSearch("");
    setStatesModalLoading(true);
    try {
      if (["partner_agent", "agent", "partner"].includes(agent.role)) {
        const org = agent.organization;
        const list = org && org.state ? [{ state: org.state }] : [];
        setStatesModalList(list);
        return;
      }
      const res = await superAdminAgentService.getAgentStates(agent.id);
      const list = res?.data || res?.states || res || [];
      setStatesModalList(Array.isArray(list) ? list : []);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load states", description: err.message });
    } finally {
      setStatesModalLoading(false);
    }
  };

  const openPartnersModal = async (agent) => {
    setPartnersModalAgent(agent);
    setPartnersModalList([]);
    setPartnersSearch("");
    setPartnersModalLoading(true);
    try {
      if (["partner_agent", "agent", "partner"].includes(agent.role)) {
        const org = agent.organization;
        setPartnersModalList(org ? [org] : []);
        return;
      }
      // ACSL Agents: the source of truth is the direct assignment table — not
      // the "by-state" endpoint which would list every partner in their states.
      let list = null;
      if (agent.role === "acsl_agent") {
        list = await fetchDirectPartnerList(supabaseRef.current, agent.id);
      }
      if (!list) {
        const res = await superAdminAgentService.getAgentOrganizations(agent.id);
        list = res?.data || res?.organizations || res || [];
      }
      setPartnersModalList(Array.isArray(list) ? list : []);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load partners", description: err.message });
    } finally {
      setPartnersModalLoading(false);
    }
  };



  const loadAgents = async () => {
    setLoading(true);
    try {
      // Unified data source: same endpoint as the Agents Performance Report,
      // so both views show the exact same agent roster and counts.
      const { supabaseFunctionsUrl } = await import("@/lib/supabaseConfig");
      const token = await tokenManager.getValidToken();
      const qs = new URLSearchParams({
        page: "1",
        limit: "5000",
        sortBy: "created_at",
        sortOrder: "desc",
      });
      const res = await fetch(`${supabaseFunctionsUrl}/manage-users?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 120)}`);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to load users");

      const rows = (json.data || [])
        .filter((u) => u.role !== "partner_agent" && u.role !== "partner")
        // Scoped callers get their own row back (needed elsewhere for form
        // cascades) but must not see — or manage — themselves in this list.
        .filter((u) => isSuperAdmin || u.id !== user?.id)
        .map((u) => ({
          id: u.id,
          full_name: u.full_name || u.name || u.email || "—",
          email: u.email,
          phone: u.phone ?? null,
          role: u.role,
          status: u.status || "active",
          created_at: u.created_at,
          last_login: u.last_login ?? null,
          assigned_organizations_count: u.assigned_organizations_count ?? 0,
          assigned_states_count: u.assigned_states_count ?? 0,
          organization_id: u.organization_id ?? null,
          organization: u.organization ?? null,
          // Server-resolved supervisor (profiles.manager_id). Legacy rows
          // without one stay undefined so the inference fallback still runs.
          supervisors: u.manager_name ? [u.manager_name] : undefined,
        }));
      setAgents(rows);
      hydrateAgentCounts(rows);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load agents", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Hydrate States/Partners counts client-side. For ACSL Agents the partner
  // count comes from the direct assignment table (so explicitly-assigned
  // partners are the source of truth, not the by-state derived list). For
  // ACSL Agent Managers the existing by-state endpoint stays authoritative.
  // Updates are batched into a single setAgents call per batch to avoid the
  // re-render storm that made the page appear to reload.
  const hydrateAgentCounts = async (agentsList) => {
    const targets = agentsList.filter(
      (a) => a.role === "acsl_agent" || a.role === "acsl_agent_manager"
    );
    const BATCH = 8;
    for (let i = 0; i < targets.length; i += BATCH) {
      if (!isMountedRef.current) return;
      const batch = targets.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (a) => {
          // Both ACSL Agents and ACSL Agent Managers count direct partner
          // assignments only — state-derived partners must not inflate the
          // badge (it must match the User Manager).
          const orgsPromise = fetchDirectPartnerCount(supabaseRef.current, a.id).then((n) =>
            n === null
              ? superAdminAgentService.getAgentOrganizations(a.id)
              : { __count: n }
          );
          const [statesRes, orgsRes] = await Promise.allSettled([
            superAdminAgentService.getAgentStates(a.id),
            orgsPromise,
          ]);

          const updates = {};
          if (statesRes.status === "fulfilled") {
            const r = statesRes.value;
            const list = r?.data || r?.states || r || [];
            if (Array.isArray(list)) updates.assigned_states_count = list.length;
          }
          if (orgsRes.status === "fulfilled") {
            const r = orgsRes.value;
            if (r && typeof r.__count === "number") {
              updates.assigned_organizations_count = r.__count;
            } else {
              const list = r?.data || r?.organizations || r || [];
              if (Array.isArray(list)) {
                const direct = list.filter((o) => !o?.source || o.source === "direct");
                updates.assigned_organizations_count = direct.length;
              }
            }

          }
          return { id: a.id, updates };
        })
      );
      if (!isMountedRef.current) return;
      const updatesById = new Map();
      results.forEach((res) => {
        if (
          res.status === "fulfilled" &&
          res.value &&
          Object.keys(res.value.updates).length > 0
        ) {
          updatesById.set(res.value.id, res.value.updates);
        }
      });
      if (updatesById.size > 0) {
        setAgents((prev) =>
          prev.map((x) =>
            updatesById.has(x.id) ? { ...x, ...updatesById.get(x.id) } : x
          )
        );
      }
    }
  };

  // Load ACSL Agent Managers with their assigned organizations so we can derive
  // each ACSL Agent's supervisor(s). Prefer direct assignment authors when they
  // are managers; otherwise pick the smallest manager set that explains the
  // agent's exact direct partner assignments.
  const hydrateSupervisors = async (agentsList) => {
    try {
      const managers = agentsList.filter((a) => a.role === "acsl_agent_manager");
      const managerInfo = await Promise.all(
        managers.map(async (m) => {
          const orgIds = (await fetchDirectPartnerList(supabaseRef.current, m.id)) || [];
          let ids = new Set();
          if (Array.isArray(orgIds) && orgIds.length > 0) {
            ids = new Set(orgIds.map((o) => o?.id).filter(Boolean));
          } else {
            try {
              const r = await superAdminAgentService.getAgentOrganizations(m.id);
              const list = r?.data || r?.organizations || r || [];
              if (Array.isArray(list)) ids = new Set(list.map((o) => o?.id || o?.organization_id).filter(Boolean));
            } catch { /* ignore */ }
          }
          return { id: m.id, name: m.full_name, orgIds: ids };
        })
      );

      const acslAgents = agentsList.filter(
        (a) => a.role === "acsl_agent" && a.supervisors === undefined
      );
      const BATCH = 8;
      for (let i = 0; i < acslAgents.length; i += BATCH) {
        if (!isMountedRef.current) return;
        const batch = acslAgents.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (a) => {
            const assignmentRows = await fetchDirectPartnerAssignmentRows(supabaseRef.current, a.id);
            const agentOrgIds = Array.isArray(assignmentRows)
              ? new Set(assignmentRows.map((row) => row?.organization_id || row?.organizations?.id).filter(Boolean))
              : new Set();
            const supervisors = inferSupervisorsForAgent(agentOrgIds, managerInfo, assignmentRows || []);
            return { id: a.id, supervisors };
          })
        );
        if (!isMountedRef.current) return;
        const map = new Map();
        results.forEach((r) => {
          if (r.status === "fulfilled" && r.value) map.set(r.value.id, r.value.supervisors);
        });
        if (map.size > 0) {
          setAgents((prev) =>
            prev.map((x) => (map.has(x.id) ? { ...x, supervisors: map.get(x.id) } : x))
          );
        }
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    (async () => {
      await loadAgents();
    })();
  }, []);

  useEffect(() => {
    const handler = () => { loadAgents(); };
    window.addEventListener("acsl:user-updated", handler);
    return () => window.removeEventListener("acsl:user-updated", handler);
  }, []);


  // Run supervisor hydration once agents have been loaded.
  useEffect(() => {
    if (agents.length === 0) return;
    if (agents.some((a) => a.role === "acsl_agent" && a.supervisors === undefined)) {
      hydrateSupervisors(agents);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]);

  const handleViewCredentials = async (agent) => {
    setLoadingCredentialId(agent.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const token = await tokenManager.getValidToken();
      const res = await fetch(
        `${supabaseUrl}/functions/v1/manage-credentials?user_id=${agent.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.success && json.data) {
        setCredentialData(json.data);
        setCredentialAgent(agent);
      } else {
        toast({
          variant: "error",
          title: "No credentials found",
          description: json.error || "This agent has no credentials.",
        });
      }
    } catch (err) {
      toast({ variant: "error", title: "Error", description: err.message });
    } finally {
      setLoadingCredentialId(null);
    }
  };

  const roles = useMemo(() => {
    const s = new Set();
    agents.forEach((a) => {
      if (a.role && a.role !== "partner_agent" && a.role !== "partner") {
        s.add(a.role);
      }
    });
    return Array.from(s).sort();
  }, [agents]);

  const formatRole = (r) => {
    if (r === "agent" || r === "agent_user") return "Agent";
    if (r === "partner_agent") return "Partner Agent";
    if (r === "acsl_agent") return "ACSL Agent";
    if (r === "acsl_agent_manager") return "ACSL Agent Manager";
    return (r || "")
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const ROLE_BADGE = {
    acsl_agent: "bg-blue-100 text-blue-700",
    acsl_agent_manager: "bg-purple-100 text-purple-700",
    super_admin: "bg-red-100 text-red-700",
    partner: "bg-amber-100 text-amber-700",
    partner_agent: "bg-teal-100 text-teal-700",
    agent: "bg-cyan-100 text-cyan-700",
    agent_user: "bg-cyan-100 text-cyan-700",
  };

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      if (filters.status && a.status !== filters.status) return false;
      if (filters.role && a.role !== filters.role) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${a.full_name ?? ""} ${a.email ?? ""} ${a.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [agents, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const startRecord = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, filtered.length);

  const hasActiveFilters = filters.search !== "" || filters.status !== "" || filters.role !== "";

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({ search: "", status: "", role: "" });
    setPage(1);
  };

  const getVisiblePages = () => {
    const pages = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader icon={Users} title="Agents Profile" />

      {/* Filter Bar */}
      <div
        className="p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3"
        style={{ backgroundColor: "#f4f7e3" }}
      >
        <div className="w-1/4 min-w-[180px]">
          <Input
            placeholder="Search name, email or phone..."
            value={filters.search}
            onChange={(e) => handleFilterChange("search", e.target.value)}
            className="bg-white h-9 text-xs shadow-none border-gray-200"
          />
        </div>


        <Select
          value={filters.role || "all"}
          onValueChange={(v) => handleFilterChange("role", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[180px] h-9 bg-white text-xs shadow-none border-gray-200 text-gray-400 data-[placeholder]:text-gray-400">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all" className="text-xs">All Roles</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">{formatRole(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={handleClearFilters}
          size="sm"
          variant="outline"
          className="h-9 bg-white shadow-none border-gray-200"
          disabled={!hasActiveFilters}
        >
          <X className="h-4 w-4 mr-1" />
          Reset Filters
        </Button>

        <p className="ml-auto text-sm text-gray-600">
          Showing <span className="font-medium">{startRecord}</span> to{" "}
          <span className="font-medium">{endRecord}</span> of{" "}
          <span className="font-medium">{filtered.length}</span> agents
        </p>
      </div>

      {/* Table */}
      <div className="space-y-0">
        <div className="bg-white border-x border-t border-gray-200 rounded-t-lg overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow style={{ backgroundColor: "#4a5d0f" }} className="hover:bg-transparent">
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap first:rounded-tl-lg">Agent Name</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Agent Phone</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Supervisor(s)</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">States Assigned</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">Partners Assigned</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-right rounded-tr-lg">Actions</TableHead>

              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-40" : ""}>
              {pageRows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                    No agents found
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((a, idx) => (
                  <TableRow
                    key={a.id}
                    className="hover:bg-[#eef3c4] text-gray-700"
                    style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                  >
                    <TableCell className="text-sm font-medium text-gray-900">
                      <span className="align-baseline">{a.full_name || "N/A"}</span>
                      {a.role && (
                        <sup className={`ml-1 text-[9px] font-medium ${
                          a.role === "super_admin" ? "text-red-600" :
                          a.role === "acsl_agent_manager" ? "text-purple-600" :
                          a.role === "acsl_agent" ? "text-green-700" :
                          a.role === "partner" ? "text-blue-600" :
                          a.role === "partner_agent" ? "text-amber-600" :
                          a.role === "agent" || a.role === "agent_user" ? "text-cyan-700" :
                          "text-gray-500"
                        }`}>
                          {formatRole(a.role)}
                        </sup>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700 whitespace-nowrap">
                      {a.phone || ""}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {a.role === "acsl_agent" ? (
                        a.supervisors === undefined ? (
                          <span className="text-gray-400 text-xs">Loading…</span>
                        ) : a.supervisors.length === 0 ? (
                          ""
                        ) : (
                          <span>{a.supervisors.join(", ")}</span>
                        )
                      ) : ["partner_agent", "agent"].includes(a.role) ? (
                        <span>{a.organization?.partner_name || ""}</span>
                      ) : (
                        ""
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-center">
                      {(() => {
                        const n = a.assigned_states_count ?? 0;
                        const cls = n > 0
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          : "bg-rose-100 text-rose-700 hover:bg-rose-200";
                        return (
                          <button
                            type="button"
                            onClick={() => openStatesModal(a)}
                            className={`inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold transition ${cls}`}
                          >
                            {n}
                          </button>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-sm text-center">
                      {(() => {
                        const n = a.total_partners_count ?? a.assigned_organizations_count ?? 0;
                        const cls = n > 0
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          : "bg-rose-100 text-rose-700 hover:bg-rose-200";
                        return (
                          <button
                            type="button"
                            onClick={() => openPartnersModal(a)}
                            className={`inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold transition ${cls}`}
                          >
                            {n}
                          </button>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        className="h-8 rounded-none bg-[#4a5d0f] hover:bg-[#3d4d0c] text-white text-xs font-medium px-3"
                        onClick={() => navigate({ to: "/user-management/users", search: { edit: a.id } })}
                      >
                        Manage Agent
                      </Button>
                    </TableCell>
                  </TableRow>

                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        {filtered.length > 0 && (
          <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-white">
            <div className="flex items-center gap-4">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">{startRecord}</span> to{" "}
                <span className="font-medium">{endRecord}</span> of{" "}
                <span className="font-medium">{filtered.length}</span> agents
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-8 w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setPage(1)} disabled={currentPage === 1}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" />Prev
                </Button>
                {getVisiblePages().map((p) => (
                  <Button
                    key={p}
                    variant={p === currentPage ? "default" : "outline"}
                    size="sm"
                    className={`h-8 w-8 p-0 ${p === currentPage ? "bg-black text-white hover:bg-black border-black" : ""}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages}>
                  Next<ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setPage(totalPages)} disabled={currentPage >= totalPages}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {detailsAgent && (
        <ViewSuperAdminAgentModal
          agent={detailsAgent}
          onClose={() => setDetailsAgent(null)}
        />
      )}

      {editingAgent && (
        <EditSuperAdminAgentModal
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSuccess={() => {
            setEditingAgent(null);
            loadAgents();
          }}
        />
      )}

      {assignAgent && (
        <AssignOrganizationsModal
          agent={assignAgent}
          onClose={() => setAssignAgent(null)}
          onSuccess={() => {
            setAssignAgent(null);
            loadAgents();
          }}
        />
      )}

      <AgentViewCredentialModal
        isOpen={!!credentialAgent}
        onClose={() => {
          setCredentialAgent(null);
          setCredentialData(null);
        }}
        credential={credentialData}
      />

      {/* States Assigned Modal */}
      <Dialog open={!!statesModalAgent} onOpenChange={(o) => !o && setStatesModalAgent(null)}>
        <DialogContent className="max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4" style={{ backgroundColor: "#4a5d0f" }}>
            <DialogTitle className="text-white text-base">
              States Assigned — {statesModalAgent?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
            {statesModalLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a5d0f]" />
              </div>
            ) : statesModalList.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No states assigned</p>
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search states..."
                    value={statesSearch}
                    onChange={(e) => setStatesSearch(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                {(() => {
                  const q = statesSearch.trim().toLowerCase();
                  const filtered = statesModalList.filter((s) => {
                    const name = typeof s === "string" ? s : (s.state || s.name || "");
                    return !q || String(name).toLowerCase().includes(q);
                  });
                  if (filtered.length === 0) {
                    return <p className="text-sm text-gray-500 text-center py-6">No matching states</p>;
                  }
                  return (
                    <ul className="space-y-2">
                      {filtered.map((s, i) => {
                        const name = typeof s === "string" ? s : (s.state || s.name || JSON.stringify(s));
                        return (
                          <li
                            key={`${name}-${i}`}
                            className="flex items-center gap-3 px-3 py-2 rounded-md border border-gray-100"
                            style={{ backgroundColor: i % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                          >
                            <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-[#eef3c4] text-[#4a5d0f]">
                              <MapPin className="h-4 w-4" />
                            </span>
                            <span className="text-sm text-gray-800 font-medium">{name}</span>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Partners Assigned Modal */}
      <Dialog open={!!partnersModalAgent} onOpenChange={(o) => !o && setPartnersModalAgent(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4" style={{ backgroundColor: "#4a5d0f" }}>
            <DialogTitle className="text-white text-base">
              Assigned Partners — {partnersModalAgent?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
            {partnersModalLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a5d0f]" />
              </div>
            ) : partnersModalList.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-10">No partners assigned</p>
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by name, state or branch..."
                    value={partnersSearch}
                    onChange={(e) => setPartnersSearch(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                {(() => {
                  const q = partnersSearch.trim().toLowerCase();
                  const getBranch = (p) =>
                    p.branch || p.branch_name || p.branch?.name || p.organization_branch || "";
                  const getName = (p) => p.partner_name || p.name || p.organization_name || "";
                  const getState = (p) => p.state || p.partner_state || "";
                  const filtered = partnersModalList.filter((p) => {
                    if (!q) return true;
                    return (
                      String(getName(p)).toLowerCase().includes(q) ||
                      String(getState(p)).toLowerCase().includes(q) ||
                      String(getBranch(p)).toLowerCase().includes(q)
                    );
                  });
                  if (filtered.length === 0) {
                    return <p className="text-sm text-gray-500 text-center py-6">No matching partners</p>;
                  }
                  return (
                    <Table>
                      <TableHeader>
                        <TableRow style={{ backgroundColor: "#eef3c4" }} className="hover:bg-transparent">
                          <TableHead className="text-[#4a5d0f] font-semibold text-xs">Partner Name</TableHead>
                          <TableHead className="text-[#4a5d0f] font-semibold text-xs">State</TableHead>
                          <TableHead className="text-[#4a5d0f] font-semibold text-xs">Branch</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((p, i) => (
                          <TableRow
                            key={p.id || p.assignment_id || i}
                            style={{ backgroundColor: i % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                          >
                            <TableCell className="text-sm text-gray-900 font-medium">
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-[#4a5d0f]" />
                                {getName(p) || "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-gray-700">{getState(p) || "—"}</TableCell>
                            <TableCell className="text-sm text-gray-700">{getBranch(p) || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  );
                })()}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default AgentsProfilesContent;

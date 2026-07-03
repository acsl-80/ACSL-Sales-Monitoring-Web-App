
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import AgentRecordsChart from "./AgentRecordsChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast, ToastContainer } from "@/components/ui/toast";
import {
  Users,
  Search,
  X,
  Loader2,
  Plus,
  UserPlus,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  MapPin,
  Check,
  Save,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Package,
  Boxes,
  Activity,
  Download,
  KeyRound,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar as CalendarIcon,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import superAdminAgentService from "../../services/superAdminAgentService";
import organizationsService from "../../services/organizationsService";
import { useAuth } from "../../contexts/useAuth";
import { lgaAndStates } from "../../constants";
import AgentFormModal from "../../components/AgentFormModal";
import DeleteSuperAdminAgentModal from "../../super-admin-agents/components/DeleteSuperAdminAgentModal";
import ViewSuperAdminAgentModal from "../../super-admin-agents/components/ViewSuperAdminAgentModal";
import AssignOrganizationsModal from "../../super-admin-agents/components/AssignOrganizationsModal";
import PageHeader from "../../components/PageHeader";
import AgentViewCredentialModal from "../../admin/components/agents/AgentViewCredentialModal";
import AgentCredentialsModal from "../../admin/components/agents/AgentCredentialsModal";
import tokenManager from "@/utils/tokenManager";

// PostgREST caps un-ranged selects at 1000 rows, silently truncating bigger
// result sets. Rebuilds the query per page (builders aren't reusable) and
// loops .range() until exhausted.
async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

interface AcslAgent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  created_at: string;
  last_login?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  updated_by_name?: string | null;
  assigned_organizations_count: number;
  assigned_states_count: number;
  total_partners_count: number;
  assigned_states?: string[];
  stove_summary?: { received: number; sold: number; available: number };
  direct_org_ids?: string[];
}

interface PartnerOrg {
  id: string;
  partner_name: string;
  state: string | null;
  branch: string | null;
  source: "direct" | "state";
  available_stoves?: number;
}

const ALL_STATES = Object.keys(lgaAndStates).sort();
const AGENTS_PERFORMANCE_ROLES = ["acsl_agent", "acsl_agent_manager"] as const;
const AGENTS_PERFORMANCE_ROLE_SET = new Set<string>(AGENTS_PERFORMANCE_ROLES);
const AGENTS_PERFORMANCE_ROLE_LABELS: Record<string, string> = {
  acsl_agent: "ACSL Agent",
  acsl_agent_manager: "ACSL Manager",
};
const ROLE_LABELS: Record<string, string> = {
  acsl_agent: "ACSL Agent",
  acsl_agent_manager: "ACSL Manager",
  super_admin: "Super Admin",
  partner: "Partner",
  partner_agent: "Partner Agent",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d !== 1 ? "s" : ""} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} week${w !== 1 ? "s" : ""} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo !== 1 ? "s" : ""} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y !== 1 ? "s" : ""} ago`;
}

// ── Assign Partner Modal ───────────────────────────────────────────────────────

interface OrgOption {
  id: string;
  partner_name: string;
  branch: string | null;
  state: string | null;
}

function AssignPartnerModal({
  agent,
  isOpen,
  onClose,
  onSuccess,
}: {
  agent: AcslAgent | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { userRole, user } = useAuth();
  const isCallerManager = userRole === "acsl_agent_manager";

  const [allOrgs, setAllOrgs] = useState<OrgOption[]>([]);
  const [selectedDirectOrgIds, setSelectedDirectOrgIds] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [orgSearch, setOrgSearch] = useState("");
  const [stateSearch, setStateSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "partner" | "state"
  const [mode, setMode] = useState<"partner" | "state">("state");
  const [stateColorMap, setStateColorMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isOpen || !agent) return;
    setOrgSearch("");
    setStateSearch("");
    setError(null);
    setMode("state");
    const load = async () => {
      setLoading(true);
      try {
        const [orgsRes, assignedRes, statesRes] = await Promise.all([
          // Managers only see their own assigned orgs; super admin sees all
          isCallerManager && user?.id
            ? superAdminAgentService.getAgentOrganizations(user.id)
            : organizationsService.getAllOrganizations(),
          superAdminAgentService.getAgentOrganizations(agent.id),
          superAdminAgentService.getAgentStates(agent.id),
        ]);
        setAllOrgs(orgsRes.data || []);
        const direct = (assignedRes.data || []).filter(
          (o: any) => !o.source || o.source === "direct"
        );
        setSelectedDirectOrgIds(new Set(direct.map((o: any) => o.id as string)));
        setSelectedStates(
          new Set((statesRes.data || []).map((s: any) => s.state as string))
        );
      } catch (err: any) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, agent, isCallerManager, user?.id]);

  const orgCountByState = useMemo(() => {
    const counts: Record<string, number> = {};
    allOrgs.forEach((o) => {
      if (o.state) counts[o.state] = (counts[o.state] || 0) + 1;
    });
    return counts;
  }, [allOrgs]);

  const stateCoveredIds = useMemo(() => {
    const ids = new Set<string>();
    allOrgs.forEach((o) => {
      if (o.state && selectedStates.has(o.state)) ids.add(o.id);
    });
    return ids;
  }, [allOrgs, selectedStates]);

  const totalUnique = useMemo(
    () => new Set([...selectedDirectOrgIds, ...stateCoveredIds]).size,
    [selectedDirectOrgIds, stateCoveredIds]
  );

  // Managers can only assign from their own states; super admin sees all
  const managerStates = useMemo(
    () => [...new Set(allOrgs.map((o: any) => o.state).filter(Boolean) as string[])].sort(),
    [allOrgs]
  );
  const availableStates = isCallerManager ? managerStates : ALL_STATES;
  const filteredStates = availableStates.filter((s) =>
    s.toLowerCase().includes(stateSearch.toLowerCase())
  );
  const filteredOrgs = allOrgs.filter((o) => {
    const q = orgSearch.toLowerCase();
    return (
      o.partner_name.toLowerCase().includes(q) ||
      (o.branch || "").toLowerCase().includes(q) ||
      (o.state || "").toLowerCase().includes(q)
    );
  });

  const toggleOrg = (id: string) =>
    setSelectedDirectOrgIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        superAdminAgentService.setAgentStates(agent.id, Array.from(selectedStates)),
        superAdminAgentService.setAgentOrganizations(agent.id, Array.from(selectedDirectOrgIds)),
      ]);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!agent) return null;

  const STATE_COLORS = [
    { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" }, // blue
    { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" }, // indigo
    { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" }, // emerald
    { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" }, // pink
    { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" }, // violet
    { bg: "#cffafe", text: "#164e63", border: "#67e8f9" }, // cyan
    { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" }, // amber
    { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" }, // red
    { bg: "#f3e8ff", text: "#6b21a8", border: "#d8b4fe" }, // purple
    { bg: "#dcfce7", text: "#14532d", border: "#86efac" }, // green
  ];

  const getStateColor = (s: string) =>
    STATE_COLORS[(stateColorMap[s] ?? 0) % STATE_COLORS.length];

  const toggleState = (s: string) => {
    const isSelected = selectedStates.has(s);
    if (isSelected) {
      const otherStates = new Set(Array.from(selectedStates).filter((st) => st !== s));
      setSelectedStates(otherStates);
      setSelectedDirectOrgIds((prev) => {
        const next = new Set(prev);
        allOrgs.forEach((o) => {
          if (o.state === s && !otherStates.has(o.state ?? "")) next.delete(o.id);
        });
        return next;
      });
    } else {
      // Assign next color index not already in use
      const usedIndices = new Set(Object.values(stateColorMap));
      let nextIdx = 0;
      while (usedIndices.has(nextIdx)) nextIdx++;
      setStateColorMap((prev) => ({ ...prev, [s]: nextIdx }));
      setSelectedStates((prev) => new Set([...prev, s]));
      const ids = allOrgs.filter((o) => o.state === s).map((o) => o.id);
      setSelectedDirectOrgIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // State grid: only unselected states matching search, scoped to manager's states if applicable
  const visibleStates = availableStates.filter(
    (s) => !selectedStates.has(s) && s.toLowerCase().includes(stateSearch.toLowerCase())
  );

  const filteredOrgsForPartnerMode = allOrgs.filter((o) => {
    const q = orgSearch.toLowerCase();
    return (
      o.partner_name.toLowerCase().includes(q) ||
      (o.branch || "").toLowerCase().includes(q) ||
      (o.state || "").toLowerCase().includes(q)
    );
  });

  // Only states that have at least one partner in allOrgs
  const selectedStatesWithPartners = Array.from(selectedStates).filter(
    (s) => allOrgs.some((o) => o.state === s)
  );

  const hasBottomContent = selectedStatesWithPartners.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[95vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="px-4 py-2.5 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <DialogTitle className="text-sm font-bold text-foreground">
            Assign partner to{" "}
            <span className="text-primary">{agent.full_name}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="px-4 pt-2.5 pb-0 shrink-0">
          <div className="flex gap-1 p-0.5 bg-muted/40 rounded-lg border border-border/50 w-fit">
            {(["state", "partner"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setOrgSearch(""); setStateSearch(""); }}
                className={[
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all",
                  mode === m
                    ? "bg-[#4a5d0f] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {m === "state" ? <MapPin className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                {m === "state" ? "By State" : "By Partner"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-0">
          {error && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700">
              <AlertCircle className="h-3 w-3 shrink-0" />{error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : mode === "state" ? (
            /* ── By State ── */
            <div className="space-y-1.5">
              {/* Selected state pills above search */}
              {selectedStates.size > 0 && (
                <div className="flex flex-wrap gap-1 pb-0.5">
                  {Array.from(selectedStates).map((s) => {
                    const c = getStateColor(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleState(s)}
                        style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-opacity hover:opacity-80"
                      >
                        {s}
                        <X className="h-2.5 w-2.5 ml-0.5" />
                      </button>
                    );
                  })}
                </div>
              )}
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold leading-tight text-[#8c0000]">
                                  Click to select state(s)
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newColorMap = { ...stateColorMap };
                                      const usedIndices = new Set(Object.values(newColorMap));
                                      let nextIdx = 0;
                                      availableStates.filter(s => !selectedStates.has(s)).forEach(s => {
                                        while (usedIndices.has(nextIdx)) nextIdx++;
                                        newColorMap[s] = nextIdx;
                                        usedIndices.add(nextIdx++);
                                      });
                                      setStateColorMap(newColorMap);
                                      setSelectedStates(new Set(availableStates));
                                      setSelectedDirectOrgIds(prev => {
                                        const next = new Set(prev);
                                        allOrgs.forEach(o => { if (o.state && availableStates.includes(o.state)) next.add(o.id); });
                                        return next;
                                      });
                                    }}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[#4a5d0f]/40 bg-[#4a5d0f]/10 text-[#4a5d0f] hover:bg-[#4a5d0f]/20 transition-colors"
                                  >
                                    Assign All
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedStates(new Set());
                                      setSelectedDirectOrgIds(prev => {
                                        const next = new Set(prev);
                                        allOrgs.forEach(o => { if (o.state) next.delete(o.id); });
                                        return next;
                                      });
                                    }}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                                  >
                                    Unassign All
                                  </button>
                                </div>
                              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search states..."
                  value={stateSearch}
                  onChange={(e) => setStateSearch(e.target.value)}
                  className="pl-6 h-7 text-[11px]"
                />
              </div>
              {visibleStates.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-4">
                  {stateSearch ? "No states match your search." : "All states selected."}
                </p>
              ) : (
                <div className="grid grid-cols-6 gap-1 max-h-52 overflow-y-auto">
                  {visibleStates.map((state) => {
                    const count = orgCountByState[state] || 0;
                    return (
                      <button
                        key={state}
                        type="button"
                        onClick={() => toggleState(state)}
                        className="flex flex-col items-center px-1 py-1.5 rounded border text-center transition-colors bg-muted/30 border-border/50 text-gray-700 hover:bg-[#4a5d0f]/10 hover:border-[#4a5d0f]/40"
                        title={`${state} — ${count} partner${count !== 1 ? "s" : ""}`}
                      >
                        <span className="text-[10px] font-semibold leading-tight truncate w-full">{state}</span>
                        <span className="text-[9px] leading-tight mt-0.5 text-muted-foreground">
                          {count} partner{count !== 1 ? "s" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── By Partner ── */
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search partners by name, state or branch..."
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                  className="pl-6 h-7 text-[11px]"
                />
              </div>
              {filteredOrgsForPartnerMode.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-6">
                  {orgSearch ? "No partners match your search." : "No partners found."}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1 max-h-64 overflow-y-auto">
                  {filteredOrgsForPartnerMode.map((org) => {
                    const selected = selectedDirectOrgIds.has(org.id);
                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => toggleOrg(org.id)}
                        className={[
                          "flex flex-col items-start px-2 py-1.5 rounded border text-left transition-colors",
                          selected
                            ? "bg-[#4a5d0f] border-[#4a5d0f] hover:bg-[#4a5d0f]/90"
                            : "bg-muted/30 border-border/50 hover:border-primary/40 hover:bg-muted/60",
                        ].join(" ")}
                      >
                        <p className={`text-[11px] font-medium truncate w-full ${selected ? "text-white" : "text-gray-900"}`}>
                          {org.partner_name}
                        </p>
                        <p className={`text-[10px] truncate w-full ${selected ? "text-white/70" : "text-muted-foreground"}`}>
                          {[org.branch, org.state].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom: column-per-state layout with checkbox rows */}
        {hasBottomContent && (
          <div className="border-t border-border/50 shrink-0 max-h-56 overflow-auto px-4 py-2">
            <div className="flex divide-x divide-border/50 min-w-0 border border-border/50 rounded-md overflow-hidden">
              {selectedStatesWithPartners.map((s) => {
                const c = getStateColor(s);
                const statePartners = allOrgs.filter((o) => o.state === s);
                const selectedCount = statePartners.filter((o) => selectedDirectOrgIds.has(o.id)).length;
                return (
                  <div key={s} className="flex-1 min-w-[160px]">
                    {/* Column header — same color as pill */}
                    <div
                      className="sticky top-0 px-2 py-1.5 flex items-center justify-between gap-1 border-b"
                      style={{ backgroundColor: c.bg, borderColor: c.border }}
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        <MapPin className="h-2.5 w-2.5 shrink-0" style={{ color: c.text }} />
                        <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: c.text }}>{s}</span>
                      </div>
                      <span className="text-[9px] shrink-0" style={{ color: c.text, opacity: 0.7 }}>{selectedCount}/{statePartners.length}</span>
                    </div>
                    {/* Partner rows */}
                    {statePartners.map((o, idx) => {
                      const checked = selectedDirectOrgIds.has(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleOrg(o.id)}
                          className={[
                            "w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors",
                            idx % 2 === 0 ? "bg-white" : "bg-blue-50/30",
                            "hover:bg-blue-50",
                          ].join(" ")}
                        >
                          {/* Checkbox */}
                          <div className={[
                            "w-3.5 h-3.5 rounded border-2 shrink-0 flex items-center justify-center transition-colors",
                            checked ? "bg-[#4a5d0f] border-[#4a5d0f]" : "border-gray-300",
                          ].join(" ")}>
                            {checked && <Check className="h-2 w-2 text-white" />}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-[11px] font-medium truncate ${checked ? "text-gray-900" : "text-gray-500"}`}>
                              {o.partner_name}
                            </p>
                            {o.branch && (
                              <p className="text-[9px] text-muted-foreground truncate">{o.branch}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2 border-t bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-[#4a5d0f] hover:bg-[#4a5d0f]/90 text-white"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-3 w-3 mr-1" />Assign Partner</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Agent Partners Modal ───────────────────────────────────────────────────────

function AssignedStovesModal({
  isOpen,
  onClose,
  orgIds,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgIds: string[];
}) {
  const { supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ stove_id: string; partner_name: string; state: string; branch: string; status: string }>>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    if (!isOpen) return;
    setSearch("");
    setPage(1);
    setRows([]);
    setError(null);
    if (!supabase || orgIds.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Fetch org name/state map
        const orgMap: Record<string, { name: string; state: string; branch: string }> = {};
        const OBATCH = 100;
        for (let i = 0; i < orgIds.length; i += OBATCH) {
          const slice = orgIds.slice(i, i + OBATCH);
          const { data: orgs } = await supabase
            .from("organizations")
            .select("id,partner_name,state,branch")
            .in("id", slice);
          (orgs || []).forEach((o: any) => {
            orgMap[o.id] = { name: o.partner_name || "—", state: o.state || "—", branch: o.branch || "—" };
          });
        }

        // Fetch ALL stove IDs (regardless of status) across orgs — the full
        // assigned pool. Status is shown per row so users can distinguish
        // sold vs available.
        const collected: Array<{ stove_id: string; partner_name: string; state: string; branch: string; status: string }> = [];
        const BATCH = 100;
        for (let i = 0; i < orgIds.length; i += BATCH) {
          const slice = orgIds.slice(i, i + BATCH);
          let from = 0;
          const PAGE = 1000;
          while (true) {
            const { data, error: err } = await supabase
              .from("stove_ids")
              .select("stove_id,organization_id,status")
              .in("organization_id", slice)
              .eq("is_archived", false)
              .range(from, from + PAGE - 1);
            if (err) throw err;
            const chunk = data || [];
            chunk.forEach((s: any) => {
              const meta = orgMap[s.organization_id] || { name: "—", state: "—", branch: "—" };
              collected.push({
                stove_id: s.stove_id,
                partner_name: meta.name,
                state: meta.state,
                branch: meta.branch,
                status: String(s.status || "—"),
              });
            });
            if (chunk.length < PAGE) break;
            from += PAGE;
          }
        }
        if (cancelled) return;
        collected.sort((a, b) => a.stove_id.localeCompare(b.stove_id));
        setRows(collected);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load stove IDs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, orgIds, supabase]);

  useEffect(() => { setPage(1); }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.stove_id.toLowerCase().includes(q) ||
        r.partner_name.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportCsv = () => {
    const esc = (v: string) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Stove ID", "Partner Name", "State", "Branch", "Status"];
    const body = filtered.map((r) => [esc(r.stove_id), esc(r.partner_name), esc(r.state), esc(r.branch), esc(r.status)].join(","));
    const csv = [header.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `assigned-stoves-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Assigned for Sale / Retrieval — Stove IDs</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stove ID, partner, state or branch..."
              className="pl-8"
            />
          </div>
          <Button onClick={exportCsv} disabled={filtered.length === 0} className="bg-black text-white hover:bg-black/80 shadow-none">
            <Download className="h-4 w-4 mr-2" />Export
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {loading ? "Loading..." : `${filtered.length.toLocaleString()} stove${filtered.length === 1 ? "" : "s"}`}
        </p>
        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        <div className="flex-1 overflow-auto border rounded mt-2">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead>Stove ID</TableHead>
                <TableHead>Partner Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
              ) : paginated.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No stoves found</TableCell></TableRow>
              ) : (
                paginated.map((r, i) => (
                  <TableRow key={`${r.stove_id}-${i}`}>
                    <TableCell className="font-mono text-sm">{r.stove_id}</TableCell>
                    <TableCell>{r.partner_name}</TableCell>
                    <TableCell>{r.state}</TableCell>
                    <TableCell>{r.branch}</TableCell>
                    <TableCell className="capitalize">{r.status}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-gray-600">Page {safePage} of {totalPages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StovesStatusModal({
  isOpen,
  onClose,
  orgIds,
  mode,
  title,
  filenamePrefix,
  showExport,
  agents,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgIds: string[];
  mode: "sold" | "unsold";
  title: string;
  filenamePrefix: string;
  showExport: boolean;
  agents?: Array<{ id: string; full_name?: string | null }>;
}) {
  const { supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ stove_id: string; partner_name: string; state: string; branch: string; agent_name?: string; sales_date?: string }>>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
  const showAgentCol = mode === "sold";

  useEffect(() => {
    if (!isOpen) return;
    setSearch("");
    setPage(1);
    setRows([]);
    setError(null);
    if (!supabase || orgIds.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const orgMap: Record<string, { name: string; state: string; branch: string }> = {};
        const OBATCH = 100;
        for (let i = 0; i < orgIds.length; i += OBATCH) {
          const slice = orgIds.slice(i, i + OBATCH);
          const { data: orgs } = await supabase
            .from("organizations")
            .select("id,partner_name,state,branch")
            .in("id", slice);
          (orgs || []).forEach((o: any) => {
            orgMap[o.id] = { name: o.partner_name || "—", state: o.state || "—", branch: o.branch || "—" };
          });
        }

        const collected: Array<{ stove_id: string; partner_name: string; state: string; branch: string; agent_name?: string; sales_date?: string }> = [];

        if (mode === "sold") {
          // Attribution-based: only stoves sold by the agents in this report.
          const agentList = agents || [];
          const agentIds = agentList.map((a) => a.id).filter(Boolean);
          const agentNameById: Record<string, string> = {};
          agentList.forEach((a) => { agentNameById[a.id] = a.full_name || "—"; });

          if (agentIds.length === 0) {
            setRows([]);
            return;
          }

          // 1. Fetch sales rows created by these agents, scoped to relevant orgs.
          type SaleRow = { id: string; organization_id: string | null; created_by: string; sales_date?: string | null };
          const salesRows: SaleRow[] = [];
          const ABATCH = 100;
          for (let i = 0; i < agentIds.length; i += ABATCH) {
            const aSlice = agentIds.slice(i, i + ABATCH);
            for (let j = 0; j < orgIds.length; j += OBATCH) {
              const oSlice = orgIds.slice(j, j + OBATCH);
              let from = 0;
              const PAGE = 1000;
              while (true) {
                const { data, error: err } = await supabase
                  .from("sales")
                  .select("id,organization_id,created_by,is_archived,sales_date")
                  .in("created_by", aSlice)
                  .in("organization_id", oSlice)
                  .eq("is_archived", false)
                  .range(from, from + PAGE - 1);
                if (err) throw err;
                const chunk = data || [];
                chunk.forEach((s: any) => salesRows.push({
                  id: s.id,
                  organization_id: s.organization_id,
                  created_by: s.created_by,
                  sales_date: s.sales_date || null,
                }));
                if (chunk.length < PAGE) break;
                from += PAGE;
              }
            }
          }

          const saleIdToAgent: Record<string, string> = {};
          const saleIdToDate: Record<string, string> = {};
          salesRows.forEach((s) => {
            saleIdToAgent[s.id] = agentNameById[s.created_by] || "—";
            saleIdToDate[s.id] = s.sales_date || "";
          });

          // 2. Fetch stove_ids linked to those sales (authoritative stove list).
          const saleIds = Array.from(new Set(salesRows.map((s) => s.id)));
          const seen = new Set<string>();
          const SIBATCH = 200;
          for (let i = 0; i < saleIds.length; i += SIBATCH) {
            const slice = saleIds.slice(i, i + SIBATCH);
            const { data, error: err } = await supabase
              .from("stove_ids")
              .select("stove_id,organization_id,sale_id,is_archived")
              .in("sale_id", slice);
            if (err) throw err;
            (data || []).forEach((s: any) => {
              if (s.is_archived) return;
              const key = `${s.stove_id}::${s.organization_id}`;
              if (seen.has(key)) return;
              seen.add(key);
              const meta = orgMap[s.organization_id] || { name: "—", state: "—", branch: "—" };
              collected.push({
                stove_id: s.stove_id,
                partner_name: meta.name,
                state: meta.state,
                branch: meta.branch,
                agent_name: saleIdToAgent[s.sale_id] || "—",
                sales_date: saleIdToDate[s.sale_id] || "",
              });
            });
          }
        } else {
          // Unsold = every non-archived stove in the agents' orgs, MINUS the
          // stove IDs already recorded as sold by these agents. Result matches
          // the "Assigned − Sold" KPI.
          const agentList = agents || [];
          const agentIds = agentList.map((a) => a.id).filter(Boolean);

          // Collect stove IDs sold by these agents at these orgs so we can
          // exclude them from the unsold list.
          const soldStoveIds = new Set<string>();
          if (agentIds.length > 0) {
            type SaleRow = { id: string };
            const saleIds: string[] = [];
            const ABATCH = 100;
            for (let i = 0; i < agentIds.length; i += ABATCH) {
              const aSlice = agentIds.slice(i, i + ABATCH);
              for (let j = 0; j < orgIds.length; j += OBATCH) {
                const oSlice = orgIds.slice(j, j + OBATCH);
                let from = 0;
                const PAGE = 1000;
                while (true) {
                  const { data, error: err } = await supabase
                    .from("sales")
                    .select("id")
                    .in("created_by", aSlice)
                    .in("organization_id", oSlice)
                    .eq("is_archived", false)
                    .range(from, from + PAGE - 1);
                  if (err) throw err;
                  const chunk = (data as SaleRow[] | null) || [];
                  chunk.forEach((s) => saleIds.push(s.id));
                  if (chunk.length < PAGE) break;
                  from += PAGE;
                }
              }
            }
            const uniqSaleIds = Array.from(new Set(saleIds));
            const SIBATCH = 200;
            for (let i = 0; i < uniqSaleIds.length; i += SIBATCH) {
              const slice = uniqSaleIds.slice(i, i + SIBATCH);
              const { data, error: err } = await supabase
                .from("stove_ids")
                .select("stove_id,organization_id")
                .in("sale_id", slice);
              if (err) throw err;
              (data || []).forEach((s: any) => {
                soldStoveIds.add(`${s.stove_id}::${s.organization_id}`);
              });
            }
          }

          const BATCH = 100;
          for (let i = 0; i < orgIds.length; i += BATCH) {
            const slice = orgIds.slice(i, i + BATCH);
            let from = 0;
            const PAGE = 1000;
            while (true) {
              const { data, error: err } = await supabase
                .from("stove_ids")
                .select("stove_id,organization_id,status")
                .in("organization_id", slice)
                .eq("is_archived", false)
                .range(from, from + PAGE - 1);
              if (err) throw err;
              const chunk = data || [];
              chunk.forEach((s: any) => {
                const key = `${s.stove_id}::${s.organization_id}`;
                if (soldStoveIds.has(key)) return;
                const meta = orgMap[s.organization_id] || { name: "—", state: "—", branch: "—" };
                collected.push({
                  stove_id: s.stove_id,
                  partner_name: meta.name,
                  state: meta.state,
                  branch: meta.branch,
                  sales_date: "",
                });
              });
              if (chunk.length < PAGE) break;
              from += PAGE;
            }
          }
        }
        if (cancelled) return;
        collected.sort((a, b) => a.stove_id.localeCompare(b.stove_id));
        setRows(collected);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load stove IDs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, orgIds, supabase, mode, agents]);

  useEffect(() => { setPage(1); }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.stove_id.toLowerCase().includes(q) ||
        r.partner_name.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        (r.agent_name || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportCsv = () => {
    const esc = (v: string) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = showAgentCol
      ? ["Stove ID", "Partner Name", "State", "Branch", "Agent", "Sales Date"]
      : ["Stove ID", "Partner Name", "State", "Branch"];
    const body = filtered.map((r) => {
      const base = [esc(r.stove_id), esc(r.partner_name), esc(r.state), esc(r.branch)];
      if (showAgentCol) {
        base.push(esc(r.agent_name || "—"));
        base.push(esc(r.sales_date ? format(new Date(r.sales_date), "dd MMM yyyy") : "—"));
      }
      return base.join(",");
    });
    const csv = [header.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const colCount = showAgentCol ? 6 : 4;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={showAgentCol ? "Search stove ID, partner, state, branch or agent..." : "Search stove ID, partner, state or branch..."}
              className="pl-8"
            />
          </div>
          {showExport && (
            <Button onClick={exportCsv} disabled={filtered.length === 0} className="bg-black text-white hover:bg-black/80 shadow-none">
              <Download className="h-4 w-4 mr-2" />Export
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {loading ? "Loading..." : `${filtered.length.toLocaleString()} stove${filtered.length === 1 ? "" : "s"}`}
        </p>
        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        <div className="flex-1 overflow-auto border rounded mt-2">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead>Stove ID</TableHead>
                <TableHead>Partner Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Branch</TableHead>
                {showAgentCol && <TableHead>Agent</TableHead>}
                {showAgentCol && <TableHead>Sales Date</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={colCount} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
              ) : paginated.length === 0 ? (
                <TableRow><TableCell colSpan={colCount} className="text-center py-8 text-gray-500">No stoves found</TableCell></TableRow>
              ) : (
                paginated.map((r, i) => (
                  <TableRow key={`${r.stove_id}-${i}`}>
                    <TableCell className="font-mono text-sm">{r.stove_id}</TableCell>
                    <TableCell>{r.partner_name}</TableCell>
                    <TableCell>{r.state}</TableCell>
                    <TableCell>{r.branch}</TableCell>
                    {showAgentCol && <TableCell>{r.agent_name || "—"}</TableCell>}
                    {showAgentCol && <TableCell>{r.sales_date ? format(new Date(r.sales_date), "dd MMM yyyy") : "—"}</TableCell>}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-gray-600">Page {safePage} of {totalPages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}



function AgentsListModal({
  isOpen,
  onClose,
  agents,
}: {
  isOpen: boolean;
  onClose: () => void;
  agents: AcslAgent[];
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => { if (isOpen) { setSearch(""); setRoleFilter("all"); setPage(1); } }, [isOpen]);
  useEffect(() => { setPage(1); }, [search, roleFilter]);

  const roleOptions = useMemo(() => {
    const s = new Set<string>();
    agents.forEach((a) => s.add(a.role));
    return Array.from(s).sort();
  }, [agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (roleFilter !== "all" && a.role !== roleFilter) return false;
      if (!q) return true;
      return (
        (a.full_name || "").toLowerCase().includes(q) ||
        (a.email || "").toLowerCase().includes(q) ||
        (a.phone || "").toLowerCase().includes(q) ||
        (a.role || "").toLowerCase().includes(q)
      );
    });
  }, [agents, search, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportCsv = () => {
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Full Name", "Role", "Email", "Phone", "Status", "Assigned Partners", "Assigned States", "Created"];
    const body = filtered.map((a) => [
      esc(a.full_name), esc(ROLE_LABELS[a.role] || a.role), esc(a.email), esc(a.phone || ""),
      esc(a.status), esc(a.total_partners_count ?? a.assigned_organizations_count ?? 0),
      esc(a.assigned_states_count ?? 0),
      esc(a.created_at ? new Date(a.created_at).toISOString().split("T")[0] : ""),
    ].join(","));
    const csv = [header.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agents-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Total Agents — Details</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone or role..."
              className="pl-8"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="border rounded px-2 py-2 text-sm bg-white"
          >
            <option value="all">All Roles</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
            ))}
          </select>
          <Button onClick={exportCsv} disabled={filtered.length === 0} className="bg-black text-white hover:bg-black/80 shadow-none">
            <Download className="h-4 w-4 mr-2" />Export
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {`${filtered.length.toLocaleString()} agent${filtered.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex-1 overflow-auto border rounded mt-2">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead>Full Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Partners</TableHead>
                <TableHead className="text-right">States</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">No agents found</TableCell></TableRow>
              ) : (
                paginated.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.full_name}</TableCell>
                    <TableCell className="text-xs">{ROLE_LABELS[a.role] || a.role}</TableCell>
                    <TableCell className="text-sm">{a.email}</TableCell>
                    <TableCell className="text-sm">{a.phone || "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{a.status}</TableCell>
                    <TableCell className="text-right">{a.total_partners_count ?? a.assigned_organizations_count ?? 0}</TableCell>
                    <TableCell className="text-right">{a.assigned_states_count ?? 0}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-gray-600">Page {safePage} of {totalPages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}



function AgentPartnersModal({
  agent,
  isOpen,
  onClose,
}: {
  agent: AcslAgent | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const PAGE_SIZE = 10;
  const { supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!isOpen || !agent) return;
    setSearch("");
    setPage(1);
    setPartners([]);
    setError(null);
    fetchPartners();
  }, [isOpen, agent]);

  // Reset to page 1 whenever search changes
  useEffect(() => { setPage(1); }, [search]);

  const fetchPartners = async () => {
    if (!agent) return;
    setLoading(true);
    try {
      const result = await superAdminAgentService.getAgentOrganizations(agent.id);
      // Only show partners that were explicitly assigned in the User Manager
      // (direct assignments). State-derived partners are excluded so the modal
      // matches the badge count and the User Manager.
      const orgs: PartnerOrg[] = (result.data || [])
        .filter((o: any) => !o.source || o.source === "direct")
        .map((o: any) => ({
          id: o.id,
          partner_name: o.partner_name,
          state: o.state ?? null,
          branch: o.branch ?? null,
          source: "direct" as const,
          available_stoves: 0,
        }));

      // Fetch available (unsold) stove counts per org
      const orgIds = orgs.map((o) => o.id);
      if (orgIds.length > 0 && supabase) {
        const BATCH = 50;
        const counts: Record<string, number> = {};
        for (let i = 0; i < orgIds.length; i += BATCH) {
          const slice = orgIds.slice(i, i + BATCH);
          const data = await fetchAllRows((from, to) =>
            supabase
              .from("stove_ids")
              .select("organization_id")
              .in("organization_id", slice)
              .eq("is_archived", false)
              .neq("status", "sold")
              .range(from, to)
          );
          data.forEach((r: any) => {
            counts[r.organization_id] = (counts[r.organization_id] || 0) + 1;
          });
        }
        orgs.forEach((o) => { o.available_stoves = counts[o.id] || 0; });
      }

      setPartners(orgs);
    } catch (err: any) {
      setError(err.message || "Failed to load partners");
    } finally {
      setLoading(false);
    }
  };


  if (!agent) return null;

  const filtered = partners.filter(
    (p) =>
      !search ||
      p.partner_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.state?.toLowerCase().includes(search.toLowerCase()) ||
      p.branch?.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const startItem = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(safePage * PAGE_SIZE, filtered.length);

  const getPageNumbers = () => {
    const pages: number[] = [];
    const start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const directCount = partners.filter((p) => p.source === "direct").length;
  const stateCount = partners.filter((p) => p.source === "state").length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <div>
            <DialogTitle className="text-base font-bold text-foreground">
              Assigned Partners
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Agent:{" "}
              <span className="font-semibold text-primary">{agent.full_name}</span>
              <span className="ml-2 bg-green-100 text-green-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                {partners.length} partner{partners.length !== 1 ? "s" : ""}
              </span>
              {directCount > 0 && (
                <span className="ml-1 bg-amber-100 text-amber-700 text-[10px] font-medium px-2 py-0.5 rounded-full">
                  {directCount} direct
                </span>
              )}
              {stateCount > 0 && (
                <span className="ml-1 bg-purple-100 text-purple-700 text-[10px] font-medium px-2 py-0.5 rounded-full">
                  {stateCount} via state
                </span>
              )}
            </p>
          </div>
        </DialogHeader>

        <div className="px-5 py-3 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search partners..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-red-600 text-sm">{error}</p>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={fetchPartners}>
                Retry
              </Button>
            </div>
          ) : partners.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              No partners assigned to this agent.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">
                      Partner Name
                    </TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">
                      State
                    </TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">
                      Branch
                    </TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap text-right">
                      Available Stoves
                    </TableHead>
                    {/* <TableHead className="text-white font-semibold text-xs whitespace-nowrap">
                      Assignment
                    </TableHead> */}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((partner, idx) => (
                    <TableRow
                      key={partner.id}
                      className={idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"}
                    >
                      <TableCell className="text-xs font-medium text-gray-900">
                        {partner.partner_name}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {partner.state || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {partner.branch || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-gray-900 text-right font-semibold">
                        {partner.available_stoves ?? 0}
                      </TableCell>
                      {/* <TableCell>
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            partner.source === "state"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {partner.source === "state" ? "Via State" : "Direct"}
                        </span>
                      </TableCell> */}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {!loading && !error && filtered.length > 0 && (
          <div className="border-t border-gray-200 px-4 py-2.5 flex items-center justify-between bg-white shrink-0">
            <p className="text-xs text-gray-500">
              {startItem}–{endItem} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setPage(1)}
                disabled={safePage === 1}
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />Prev
              </Button>
              {getPageNumbers().map((p) => (
                <Button
                  key={p}
                  variant={p === safePage ? "default" : "outline"}
                  size="sm"
                  className={`h-7 w-7 p-0 text-xs ${p === safePage ? "bg-[#4a5d0f] text-white hover:bg-[#4a5d0f]" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Next<ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setPage(totalPages)}
                disabled={safePage >= totalPages}
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Agent States Modal ─────────────────────────────────────────────────────────


function AgentStatesModal({
  agent,
  isOpen,
  onClose,
}: {
  agent: AcslAgent | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen || !agent) return;
    setError(null);
    setStates([]);
    const load = async () => {
      setLoading(true);
      try {
        const result = await superAdminAgentService.getAgentStates(agent.id);
        const sorted: string[] = ((result.data || []) as any[])
          .map((s: any) => s.state as string)
          .sort();
        setStates(sorted);
      } catch (err: any) {
        setError(err.message || "Failed to load states");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, agent]);

  if (!agent) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <div>
            <DialogTitle className="text-base font-bold text-foreground">States Assigned</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Agent: <span className="font-semibold text-primary">{agent.full_name}</span>
              {!loading && (
                <span className="ml-2 bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5 rounded-full">
                  {states.length} state{states.length !== 1 ? "s" : ""}
                </span>
              )}
            </p>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          ) : states.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              <MapPin className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              No states assigned to this agent.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {states.map((s) => (
                <span
                  key={s}
                  className="bg-primary/10 text-primary text-[11px] font-mono px-2.5 py-1 rounded"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>


      </DialogContent>
    </Dialog>
  );
}


// ── Active Partners Modal ──────────────────────────────────────────────────────

interface ActivePartner {
  id: string;
  partner_name: string;
  state: string | null;
  branch: string | null;
  contact_phone: string | null;
  total_stove_ids: number;
  sold_stove_ids: number;
  available_stove_ids: number;
  agents_count: number;
}

function ActivePartnersModal({
  isOpen,
  onClose,
  partnerIds,
  dateBadge,
}: {
  isOpen: boolean;
  onClose: () => void;
  partnerIds: string[];
  dateBadge: string;
}) {
  const { supabase } = useAuth();
  const PAGE_SIZE = 15;
  const [partners, setPartners] = useState<ActivePartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!isOpen) return;
    setSearch("");
    setPage(1);
    setPartners([]);
    if (partnerIds.length === 0) return;
    setLoading(true);

    const load = async () => {
      try {
        const BATCH = 200;

        // Fetch org records
        const orgBatches: Promise<any>[] = [];
        for (let i = 0; i < partnerIds.length; i += BATCH) {
          orgBatches.push(
            supabase
              .from("organizations")
              .select("id, partner_name, state, branch, contact_phone")
              .in("id", partnerIds.slice(i, i + BATCH))
          );
        }
        const orgResults = await Promise.all(orgBatches);
        const orgs: any[] = orgResults.flatMap((r) => r.data || []);

        // Fetch stove counts grouped by org (client-side aggregation)
        const stoveBatches: Promise<any[]>[] = [];
        for (let i = 0; i < partnerIds.length; i += BATCH) {
          const slice = partnerIds.slice(i, i + BATCH);
          stoveBatches.push(
            fetchAllRows((from, to) =>
              supabase
                .from("stove_ids")
                .select("organization_id, status")
                .in("organization_id", slice)
                .eq("is_archived", false)
                .range(from, to)
            )
          );
        }
        const stoveResults = await Promise.all(stoveBatches);
        const stoveCounts: Record<string, { total: number; sold: number; available: number }> = {};
        stoveResults.flat().forEach((s: any) => {
          if (!stoveCounts[s.organization_id]) stoveCounts[s.organization_id] = { total: 0, sold: 0, available: 0 };
          stoveCounts[s.organization_id].total++;
          if (s.status === "sold") stoveCounts[s.organization_id].sold++;
          else stoveCounts[s.organization_id].available++;
        });

        // Fetch direct agent assignment counts
        const agentBatches: Promise<any>[] = [];
        for (let i = 0; i < partnerIds.length; i += BATCH) {
          agentBatches.push(
            supabase
              .from("super_admin_agent_organizations")
              .select("organization_id")
              .in("organization_id", partnerIds.slice(i, i + BATCH))
          );
        }
        const agentResults = await Promise.all(agentBatches);
        const agentCounts: Record<string, number> = {};
        agentResults.flatMap((r) => r.data || []).forEach((row: any) => {
          agentCounts[row.organization_id] = (agentCounts[row.organization_id] || 0) + 1;
        });

        const merged: ActivePartner[] = orgs.map((org) => ({
          id: org.id,
          partner_name: org.partner_name,
          state: org.state,
          branch: org.branch,
          contact_phone: org.contact_phone,
          total_stove_ids: stoveCounts[org.id]?.total ?? 0,
          sold_stove_ids: stoveCounts[org.id]?.sold ?? 0,
          available_stove_ids: stoveCounts[org.id]?.available ?? 0,
          agents_count: agentCounts[org.id] ?? 0,
        }));
        merged.sort((a, b) => (a.partner_name ?? "").localeCompare(b.partner_name ?? ""));
        setPartners(merged);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [isOpen, partnerIds, supabase]);

  useEffect(() => { setPage(1); }, [search]);

  const filtered = partners.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.partner_name ?? "").toLowerCase().includes(q) ||
      (p.state ?? "").toLowerCase().includes(q) ||
      (p.branch ?? "").toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const startItem = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(safePage * PAGE_SIZE, filtered.length);

  const getPageNumbers = () => {
    const pages: number[] = [];
    const start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-[#6d28d9]/5 to-[#8b5cf6]/10 border-b shrink-0">
          <div>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#8b5cf6]" />
              Active Partners
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-semibold text-[#6d28d9]">{partnerIds.length} partner{partnerIds.length !== 1 ? "s" : ""}</span>
              {" "}with sales · {dateBadge}
            </p>
          </div>
        </DialogHeader>

        <div className="px-5 py-3 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name, state or branch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#6d28d9]" />
            </div>
          ) : partnerIds.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              No active partners for this period.
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              No partners match your search.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Partner</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">State</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Branch</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Phone Number</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Stoves (Received / Sold / Available)</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Agents Assigned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((partner, idx) => (
                    <TableRow
                      key={partner.id}
                      className={`${idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"} hover:bg-gray-50 text-gray-700`}
                    >
                      <TableCell className="text-xs font-medium text-gray-900">{partner.partner_name}</TableCell>
                      <TableCell className="text-xs">{partner.state || "N/A"}</TableCell>
                      <TableCell className="text-xs">{partner.branch || "N/A"}</TableCell>
                      <TableCell className="text-xs">{partner.contact_phone || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-medium text-purple-700" title="Received">{partner.total_stove_ids.toLocaleString()}</span>
                          <span className="text-gray-300">/</span>
                          <span className="font-medium text-blue-600" title="Sold">{partner.sold_stove_ids.toLocaleString()}</span>
                          <span className="text-gray-300">/</span>
                          <span className="font-medium text-green-600" title="Available">{partner.available_stove_ids.toLocaleString()}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {partner.agents_count === 0 ? (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">0</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            {partner.agents_count}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {!loading && filtered.length > 0 && (
          <div className="border-t border-gray-200 px-4 py-2.5 flex items-center justify-between bg-white shrink-0">
            <p className="text-xs text-gray-500">{startItem}–{endItem} of {filtered.length}</p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={safePage === 1}>
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
                  <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />Prev
                </Button>
                {getPageNumbers().map((p) => (
                  <Button
                    key={p}
                    variant={p === safePage ? "default" : "outline"}
                    size="sm"
                    className={`h-7 w-7 p-0 text-xs ${p === safePage ? "bg-[#4a5d0f] text-white hover:bg-[#4a5d0f]" : ""}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                  Next<ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Stock Modal ────────────────────────────────────────────────────────────────

function StockModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { supabase } = useAuth();
  const PAGE_SIZE = 20;
  const [stoves, setStoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!isOpen) return;
    setSearch(""); setPage(1); setStoves([]);
    setLoading(true);
    fetchAllRows((from, to) =>
      supabase
        .from("stove_ids")
        .select("id, stove_id, status, organization_id, organizations(partner_name, state)")
        .eq("status", "available")
        .order("stove_id", { ascending: true })
        .range(from, to)
    )
      .then((data: any[]) => setStoves(data))
      .catch(() => setStoves([]))
      .finally(() => setLoading(false));
  }, [isOpen, supabase]);

  useEffect(() => { setPage(1); }, [search]);

  const filtered = stoves.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.stove_id?.toLowerCase().includes(q) ||
      (s.organizations as any)?.partner_name?.toLowerCase().includes(q) ||
      (s.organizations as any)?.state?.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportCSV = () => {
    const rows = [
      ["#", "Stove ID", "Partner", "State"],
      ...filtered.map((s, i) => [
        i + 1,
        s.stove_id ?? "",
        (s.organizations as any)?.partner_name ?? "—",
        (s.organizations as any)?.state ?? "—",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "stoves_in_stock.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = filtered
      .map((s, i) => `<tr><td>${i + 1}</td><td>${s.stove_id ?? ""}</td><td>${(s.organizations as any)?.partner_name ?? "—"}</td><td>${(s.organizations as any)?.state ?? "—"}</td></tr>`)
      .join("");
    win.document.write(`<html><head><title>Stoves in Stock</title><style>
      body{font-family:sans-serif;font-size:12px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}
      th{background:#07376a;color:white}
      tr:nth-child(even){background:#f0f5ff}
      @media print{button{display:none}}
    </style></head><body>
    <h2 style="margin-bottom:8px">Stoves in Stock (${filtered.length})</h2>
    <table><thead><tr><th>#</th><th>Stove ID</th><th>Partner</th><th>State</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`);
    win.document.close();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold text-foreground">Stoves in Stock</DialogTitle>
              {/* <p className="text-xs text-muted-foreground mt-0.5">
                {loading ? "Loading…" : (
                  <span className="font-semibold text-primary">{stoves.length.toLocaleString()} stove{stoves.length !== 1 ? "s" : ""}</span>
                )} currently available
              </p> */}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportCSV} disabled={loading || filtered.length === 0}>
                <Download className="h-3 w-3 mr-1" />CSV
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportPDF} disabled={loading || filtered.length === 0}>
                <Download className="h-3 w-3 mr-1" />PDF
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-2.5 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by stove ID, partner or state..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Boxes className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{search ? "No stoves match your search." : "No stoves currently in stock."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
                    <TableHead className="text-white font-semibold text-xs w-10">#</TableHead>
                    <TableHead className="text-white font-semibold text-xs">Stove ID</TableHead>
                    <TableHead className="text-white font-semibold text-xs">Partner</TableHead>
                    <TableHead className="text-white font-semibold text-xs">State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((s, idx) => (
                    <TableRow key={s.id} className={idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"}>
                      <TableCell className="text-xs text-gray-400">{(safePage - 1) * PAGE_SIZE + idx + 1}</TableCell>
                      <TableCell className="text-xs font-mono font-semibold text-gray-900">{s.stove_id}</TableCell>
                      <TableCell className="text-xs text-gray-700">{(s.organizations as any)?.partner_name || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-600">{(s.organizations as any)?.state || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {!loading && filtered.length > PAGE_SIZE && (
          <div className="border-t border-gray-200 px-4 py-2.5 flex items-center justify-between bg-white shrink-0">
            <p className="text-xs text-gray-500">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={safePage === 1}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}><ChevronLeft className="h-3.5 w-3.5 mr-0.5" />Prev</Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Next<ChevronRight className="h-3.5 w-3.5 ml-0.5" /></Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}><ChevronsRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export default function SuperAdminAgentsContent() {
  const { toast, toasts, removeToast } = useToast();
  const { supabase } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [kpiStats, setKpiStats] = useState({
    totalSoldByAgents: 0,
    totalActiveAgents: 0,
    mostActiveState: null as string | null,
    mostActiveStateSales: 0,
    totalActivePartners: 0,
    stovesInStock: 0,
  });
  const [loadingKpi, setLoadingKpi] = useState(false);
  const [activeAgentIdsInRange, setActiveAgentIdsInRange] = useState<Set<string>>(new Set());
  const [activePartnerIdsInRange, setActivePartnerIdsInRange] = useState<string[]>([]);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showActivePartnersModal, setShowActivePartnersModal] = useState(false);
  const [agents, setAgents] = useState<AcslAgent[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const roleDropdownRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [agentFormMode, setAgentFormMode] = useState<"create" | "edit" | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AcslAgent | null>(null);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [credentialData, setCredentialData] = useState<any>(null);
  const [loadingCredentialId, setLoadingCredentialId] = useState<string | null>(null);
  const [newAgentCredentials, setNewAgentCredentials] = useState<any>(null);
  const [showNewCredentialModal, setShowNewCredentialModal] = useState(false);
  const [partnersModalAgent, setPartnersModalAgent] = useState<AcslAgent | null>(null);
  const [assignPartnerAgent, setAssignPartnerAgent] = useState<AcslAgent | null>(null);
  const [statesModalAgent, setStatesModalAgent] = useState<AcslAgent | null>(null);

  const [sortMode, setSortMode] = useState("default");
  const [stoveSort, setStoveSort] = useState<{ key: string | null; direction: "asc" | "desc" | null }>({ key: null, direction: null });
  // Deduped totals across unique partner organizations (avoids double-counting shared orgs).
  const [stoveTotals, setStoveTotals] = useState<{ assigned: number; sold: number; unsold: number } | null>(null);
  const [kpiAssignedOrgIds, setKpiAssignedOrgIds] = useState<string[]>([]);
  const [showAssignedStovesModal, setShowAssignedStovesModal] = useState(false);
  const [showSoldStovesModal, setShowSoldStovesModal] = useState(false);
  const [showUnsoldStovesModal, setShowUnsoldStovesModal] = useState(false);
  const [rowStoveModal, setRowStoveModal] = useState<{ agent: AcslAgent; mode: "assigned" | "sold" | "unsold" } | null>(null);
  const [showAgentsListModal, setShowAgentsListModal] = useState(false);
  // Per-role totals across all matching users (not just current page), used by KPI breakdown.
  const [roleTotals, setRoleTotals] = useState<Record<string, number>>({});
  const cycleStoveSort = (key: string) => {
    setStoveSort((prev) => {
      if (prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      if (prev.direction === "desc") return { key: null, direction: null };
      return { key, direction: "asc" };
    });
  };
  const stoveSortFieldMap: Record<string, "received" | "sold" | "available"> = {
    assigned: "received",
    collected: "sold",
    in_stock: "available",
  };
  const StoveSortIcon = ({ col }: { col: string }) => {
    if (stoveSort.key !== col || !stoveSort.direction) return <ArrowUpDown className="w-3.5 h-3.5 opacity-70 inline" />;
    return stoveSort.direction === "asc" ? <ArrowUp className="w-3.5 h-3.5 inline" /> : <ArrowDown className="w-3.5 h-3.5 inline" />;
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { supabaseFunctionsUrl } = await import("@/lib/supabaseConfig");
      const token = await tokenManager.getValidToken();
      const rolesToFetch = selectedRoles.length > 0
        ? selectedRoles.filter((role) => AGENTS_PERFORMANCE_ROLE_SET.has(role))
        : [...AGENTS_PERFORMANCE_ROLES];

      if (rolesToFetch.length === 0) {
        setAgents([]);
        setRoleTotals({});
        setPagination({
          currentPage: 1,
          itemsPerPage: pageSize,
          totalItems: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        });
        setStoveTotals({ assigned: 0, sold: 0, unsold: 0 });
        return;
      }

      const fetchRoleUsers = async (role: string) => {
        const roleUsers: any[] = [];
        let nextPage = 1;
        let totalPagesForRole = 1;

        do {
          const qs = new URLSearchParams({
            page: String(nextPage),
            limit: "100",
            sortBy: "created_at",
            sortOrder: "desc",
            role,
          });
          if (search.trim()) qs.append("search", search.trim());
          if (statusFilter !== "all") qs.append("status", statusFilter);

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

          roleUsers.push(...(json.data || []));
          totalPagesForRole = json.pagination?.totalPages ?? 1;
          nextPage += 1;
        } while (nextPage <= totalPagesForRole);

        return roleUsers;
      };

      const allUsers = (await Promise.all(rolesToFetch.map(fetchRoleUsers))).flat();
      const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
      const toTime = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

      const rows = allUsers
        .filter((u: any) => AGENTS_PERFORMANCE_ROLE_SET.has(u.role))
        .filter((u: any) => {
          if (!fromTime && !toTime) return true;
          const createdTime = new Date(u.created_at).getTime();
          if (Number.isNaN(createdTime)) return false;
          if (fromTime && createdTime < fromTime) return false;
          if (toTime && createdTime > toTime) return false;
          return true;
        })
        .map((u: any) => ({
          id: u.id,
          full_name: u.full_name || u.name || u.email || "—",
          email: u.email,
          phone: u.phone ?? null,
          role: u.role,
          status: u.status || "active",
          created_at: u.created_at,
          last_login: u.last_login ?? null,
          updated_at: u.updated_at ?? null,
          updated_by: u.updated_by ?? null,
          updated_by_name: u.updated_by_name ?? null,
          assigned_organizations_count: u.assigned_organizations_count ?? 0,
          assigned_states_count: u.assigned_states_count ?? 0,
          total_partners_count: u.total_partners_count ?? u.assigned_organizations_count ?? 0,
        }))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setAgents(rows);
      setRoleTotals(
        rows.reduce<Record<string, number>>((acc, row) => {
          acc[row.role] = (acc[row.role] || 0) + 1;
          return acc;
        }, {})
      );

      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      setPagination({
        currentPage: Math.min(page, totalPages),
        itemsPerPage: pageSize,
        totalItems: rows.length,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      });
    } catch (err: any) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, selectedRoles, dateFrom, dateTo]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);
  useEffect(() => { setPage(1); }, [search, statusFilter, selectedRoles, dateFrom, dateTo]);
  useEffect(() => {
    const handler = () => { fetchAgents(); };
    window.addEventListener("acsl:user-updated", handler);
    return () => window.removeEventListener("acsl:user-updated", handler);
  }, [fetchAgents]);


  // Hydrate Assigned / Collected / In Stock per agent from their assigned partner orgs.
  // Assigned = total stoves across agent's partners; Collected = sold; In Stock = available.
  const agentIdsKey = useMemo(() => agents.map((a) => a.id).join(","), [agents]);
  useEffect(() => {
    if (!agents.length) return;
    let cancelled = false;
    (async () => {
      try {
        const { getSupabase } = await import("@/lib/supabaseClient");
        const supabase = getSupabase();

        // 1. Orgs per agent (direct + via state assignments).
        const orgListResults = await Promise.all(
          agents.map((a) => {
            // The super-admin-agents edge function only knows about ACSL roles
            // (acsl_agent / acsl_agent_manager). Calling it for partner /
            // partner_agent / agent roles 404s ("Agent not found"). Skip them.
            if (a.role !== "acsl_agent" && a.role !== "acsl_agent_manager") {
              return Promise.resolve({ id: a.id, orgs: [] as any[] });
            }
            return superAdminAgentService
              .getAgentOrganizations(a.id)
              .then((res: any) => ({ id: a.id, orgs: (res?.data || []) as any[] }))
              .catch(() => ({ id: a.id, orgs: [] as any[] }));
          })
        );
        if (cancelled) return;

        // For stove math we use ALL orgs the agent can reach (direct + via state).
        // For partner *counts* we use ONLY direct assignments, so the badge
        // matches what was explicitly set in the User Manager.
        const agentToOrgIds: Record<string, string[]> = {};
        const agentToDirectOrgIds: Record<string, string[]> = {};
        const allOrgIds = new Set<string>();
        for (const r of orgListResults) {
          const ids = r.orgs.map((o: any) => o.id).filter(Boolean);
          const directIds = r.orgs
            .filter((o: any) => !o.source || o.source === "direct")
            .map((o: any) => o.id)
            .filter(Boolean);
          agentToOrgIds[r.id] = ids;
          agentToDirectOrgIds[r.id] = directIds;
          ids.forEach((id) => allOrgIds.add(id));
        }


        // 2. Stove counts per org — count TOTAL non-archived stoves per org
        //    (the fixed pool assigned to sell), and separately track how many
        //    are still available and how many are already marked sold.
        const directOrgIdSet = new Set<string>();
        Object.values(agentToDirectOrgIds).forEach((ids) =>
          ids.forEach((id) => directOrgIdSet.add(id))
        );
        const orgIds = Array.from(directOrgIdSet);
        const BATCH = 200;
        const stoveTotalByOrg: Record<string, number> = {};
        const stoveAvailableByOrg: Record<string, number> = {};
        const stoveSoldByOrg: Record<string, number> = {};
        for (let i = 0; i < orgIds.length; i += BATCH) {
          const slice = orgIds.slice(i, i + BATCH);
          // Paginate past PostgREST's 1000-row cap — a single un-ranged
          // select silently truncates, undercounting orgs with big pools.
          let from = 0;
          const PAGE = 1000;
          while (true) {
            const { data, error: err } = await supabase
              .from("stove_ids")
              .select("organization_id,status")
              .in("organization_id", slice)
              .eq("is_archived", false)
              .range(from, from + PAGE - 1);
            if (err) throw err;
            const chunk = data || [];
            chunk.forEach((s: any) => {
              const oid = s.organization_id;
              const status = String(s.status || "").toLowerCase();
              stoveTotalByOrg[oid] = (stoveTotalByOrg[oid] || 0) + 1;
              if (status === "sold") {
                stoveSoldByOrg[oid] = (stoveSoldByOrg[oid] || 0) + 1;
              } else {
                stoveAvailableByOrg[oid] = (stoveAvailableByOrg[oid] || 0) + 1;
              }
            });
            if (chunk.length < PAGE) break;
            from += PAGE;
          }
        }
        if (cancelled) return;

        // 3. Collected (per agent) = actual sales records created by each agent.
        const soldByAgent: Record<string, number> = {};
        await Promise.all(
          agents.map(async (a) => {
            const { count } = await supabase
              .from("sales")
              .select("*", { count: "exact", head: true })
              .eq("created_by", a.id)
              .eq("is_archived", false);
            soldByAgent[a.id] = count || 0;
          })
        );
        if (cancelled) return;

        // 4. Global totals.
        //    Assigned = total stoves across the unique set of directly-assigned
        //                partners (deduped so shared partners aren't counted twice).
        //    Sold     = per-agent sales attributed via created_by.
        //    Unsold   = Assigned − Sold (never negative).
        let globalAssigned = 0;
        let globalSold = 0;
        for (const oid of orgIds) globalAssigned += stoveTotalByOrg[oid] || 0;
        for (const a of agents) globalSold += soldByAgent[a.id] || 0;
        setStoveTotals({
          assigned: globalAssigned,
          sold: globalSold,
          unsold: Math.max(0, globalAssigned - globalSold),
        });
        setKpiAssignedOrgIds(orgIds);

        // 5. Merge per-agent stove_summary. received = total stoves at the
        //    agent's directly-assigned partners; sold = agent's own sales;
        //    available = received − sold.
        setAgents((prev) =>
          prev.map((a) => {
            const orgs = agentToDirectOrgIds[a.id] || [];
            let received = 0;
            for (const oid of orgs) received += stoveTotalByOrg[oid] || 0;
            const sold = soldByAgent[a.id] || 0;
            const available = Math.max(0, received - sold);
            // For ACSL roles, prefer the hydrated org count so managers also
            // see their assigned partners (backend list may not populate it).
            const isAcslRole = a.role === "acsl_agent" || a.role === "acsl_agent_manager";
            const directOrgs = agentToDirectOrgIds[a.id] || [];
            const assigned_organizations_count = isAcslRole
              ? directOrgs.length
              : a.assigned_organizations_count;
            const total_partners_count = isAcslRole
              ? directOrgs.length
              : a.total_partners_count;

            return {
              ...a,
              assigned_organizations_count,
              total_partners_count,
              stove_summary: { received, sold, available },
              direct_org_ids: directOrgs,
            };
          })
        );

      } catch {
        // silent: columns fall back to em-dash
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIdsKey]);



  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setRoleDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);


  const fetchKpiStats = useCallback(async () => {
    setLoadingKpi(true);
    try {
      const result = await superAdminAgentService.getAgentKpiStats({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      const d = result.data;
      setKpiStats({
        totalSoldByAgents: d.totalSoldByAgents ?? 0,
        totalActiveAgents: d.totalActiveAgents ?? 0,
        mostActiveState: d.mostActiveState ?? null,
        mostActiveStateSales: d.mostActiveStateSales ?? 0,
        totalActivePartners: d.totalActivePartners ?? 0,
        stovesInStock: d.stovesInStock ?? 0,
      });
      setActiveAgentIdsInRange(new Set<string>(d.activeAgentIds ?? []));
      setActivePartnerIdsInRange(d.activePartnerIds ?? []);
    } catch (err) {
      console.error("KPI stats error:", err);
    } finally {
      setLoadingKpi(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchKpiStats(); }, [fetchKpiStats]);


  // ── Actions ────────────────────────────────────────────────────────────────
  const handleViewCredentials = async (agent: AcslAgent) => {
    setLoadingCredentialId(agent.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const token = await tokenManager.getValidToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/manage-credentials?user_id=${agent.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success && json.data) {
        setCredentialData(json.data);
        setSelectedAgent(agent);
        setShowCredentialModal(true);
      } else {
        alert(json.error ?? "Credentials not found for this agent");
      }
    } catch {
      alert("Failed to load credentials");
    } finally {
      setLoadingCredentialId(null);
    }
  };

  const handleToggleStatus = async (agent: AcslAgent) => {
    const newStatus = agent.status === "active" ? "disabled" : "active";
    try {
      await superAdminAgentService.updateSuperAdminAgent(agent.id, { status: newStatus });
      toast({
        variant: "success",
        title: `"${agent.full_name}" ${newStatus === "active" ? "enabled" : "disabled"} successfully`,
      });
      fetchAgents();
    } catch (err: any) {
      toast({ variant: "error", title: err.message || "Failed to update status" });
    }
  };

  // ── Pagination helpers ─────────────────────────────────────────────────────
  const totalItems = pagination?.totalItems ?? agents.length;
  const totalPages = pagination?.totalPages ?? 1;
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  const getPageNumbers = () => {
    const pages: number[] = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const maxReceived = agents.reduce((max, a) => Math.max(max, a.stove_summary?.received ?? 0), 0);
  const topReceivedAgents = agents.filter((a) => maxReceived > 0 && (a.stove_summary?.received ?? 0) === maxReceived);

  const formatTopNames = (list: AcslAgent[]) => {
    if (list.length === 0) return null;
    return list.map((a) => a.full_name).join(" · ");
  };

  const sortedAgents = useMemo(() => {
    const list = [...agents];
    if (sortMode === "most_received") {
      return list.sort((a, b) => (b.stove_summary?.received ?? 0) - (a.stove_summary?.received ?? 0));
    }
    if (sortMode === "most_sold") {
      return list.sort((a, b) => (b.stove_summary?.sold ?? 0) - (a.stove_summary?.sold ?? 0));
    }
    if (sortMode === "active_agents") {
      return list.filter((a) => activeAgentIdsInRange.has(a.id));
    }
    if (sortMode === "most_active_state" && kpiStats.mostActiveState) {
      return list.filter((a) => a.assigned_states?.includes(kpiStats.mostActiveState!));
    }
    if (sortMode === "active_partners") {
      return list.sort((a, b) => (b.total_partners_count ?? 0) - (a.total_partners_count ?? 0));
    }
    return list;
  }, [agents, sortMode, activeAgentIdsInRange, kpiStats.mostActiveState]);

  const displayedAgents = useMemo(() => {
    if (!stoveSort.key || !stoveSort.direction) return sortedAgents;
    const dir = stoveSort.direction === "asc" ? 1 : -1;
    if (stoveSort.key === "partners") {
      return [...sortedAgents].sort((a, b) => (((a.assigned_organizations_count ?? 0) - (b.assigned_organizations_count ?? 0)) * dir));
    }
    const field = stoveSortFieldMap[stoveSort.key];
    if (!field) return sortedAgents;
    return [...sortedAgents].sort((a, b) => (((a.stove_summary?.[field] ?? 0) - (b.stove_summary?.[field] ?? 0)) * dir));
  }, [sortedAgents, stoveSort]);

  const dateBadgeLabel = useMemo(() => {
    const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return (dateFrom || dateTo)
      ? `${dateFrom ? fmt(dateFrom) : "…"} – ${dateTo ? fmt(dateTo) : "…"}`
      : new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }, [dateFrom, dateTo]);

  return (
    <DashboardLayout currentRoute="agents" title="Agent Manager">
      <div className="p-6 space-y-5">

        <PageHeader
          icon={Users}
          title="Agents Performance Report"
        />

        {/* Filters */}
        <div
          className="p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3"
          style={{ backgroundColor: "#f4f7e3" }}
        >
          <div className="w-1/4 min-w-[180px]">
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-white h-9 text-xs shadow-none border-gray-200"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[150px] h-9 bg-white text-xs shadow-none border-gray-200">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
              <SelectItem value="active" className="text-xs">Active</SelectItem>
              <SelectItem value="disabled" className="text-xs">Disabled</SelectItem>
            </SelectContent>
          </Select>
          {/* Multi-select role filter */}
          <div ref={roleDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setRoleDropdownOpen((o) => !o)}
              className="flex items-center justify-between gap-2 h-9 px-3 bg-white border border-gray-200 rounded-md text-xs min-w-[160px] max-w-[220px] hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#4a5d0f]/30 shadow-none"
            >
              <span className="truncate text-left">
                {selectedRoles.length === 0 || selectedRoles.length === 3
                  ? "All Roles"
                  : selectedRoles
                      .map((r) =>
                        r === "acsl_agent"
                          ? "ACSL Agent"
                          : r === "acsl_agent_manager"
                          ? "Agent Manager"
                          : "Super Admin"
                      )
                      .join(", ")}
              </span>
              <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${roleDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {roleDropdownOpen && (
              <div className="absolute z-50 mt-1 left-0 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[200px]">
                {/* All Roles option */}
                <button
                  type="button"
                  onClick={() => { setSelectedRoles([]); setPage(1); setRoleDropdownOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${selectedRoles.length === 0 ? "text-[#4a5d0f] font-semibold" : "text-gray-700"}`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${selectedRoles.length === 0 ? "bg-[#4a5d0f] border-[#4a5d0f]" : "border-gray-300"}`}>
                    {selectedRoles.length === 0 && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  All Roles
                </button>
                <div className="border-t border-gray-100 my-0.5" />
                {(
                  [
                    { value: "acsl_agent", label: "ACSL Agent" },
                    { value: "acsl_agent_manager", label: "ACSL Agent Manager" },
                    { value: "super_admin", label: "Super Admin" },
                  ] as const
                ).map(({ value, label }) => {
                  const checked = selectedRoles.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setSelectedRoles((prev) => {
                          const next = prev.includes(value)
                            ? prev.filter((r) => r !== value)
                            : [...prev, value];
                          return next;
                        });
                        setPage(1);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-gray-700"
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? "bg-[#4a5d0f] border-[#4a5d0f]" : "border-gray-300"}`}>
                        {checked && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* Date Range Filter (dashboard-style) */}
          {(() => {
            const fromDate = dateFrom ? parseISO(dateFrom) : undefined;
            const toDate = dateTo ? parseISO(dateTo) : undefined;
            const label = fromDate && toDate
              ? `${format(fromDate, "MMM d, yyyy")} – ${format(toDate, "MMM d, yyyy")}`
              : fromDate
                ? `${format(fromDate, "MMM d, yyyy")} – …`
                : "Filter by date range";
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-9 px-3 flex items-center gap-1.5 rounded-md text-xs bg-white border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#4a5d0f]/30"
                  >
                    <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
                    <span className={!fromDate ? "text-gray-500" : "text-gray-800"}>{label}</span>
                    {fromDate && (
                      <X
                        className="h-3.5 w-3.5 text-gray-400 hover:text-gray-700 ml-1"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDateFrom("");
                          setDateTo("");
                          setSelectedMonth("");
                          setPage(1);
                        }}
                      />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={{ from: fromDate, to: toDate }}
                    onSelect={(range: any) => {
                      setDateFrom(range?.from ? format(range.from, "yyyy-MM-dd") : "");
                      setDateTo(range?.to ? format(range.to, "yyyy-MM-dd") : "");
                      setSelectedMonth("");
                      setPage(1);
                    }}
                    numberOfMonths={2}
                    disabled={{ after: new Date() }}
                    toDate={new Date()}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            );
          })()}

          <Button
            onClick={() => { setSearch(""); setStatusFilter("all"); setSelectedRoles(["acsl_agent"]); setDateFrom(""); setDateTo(""); setSelectedMonth(""); setPage(1); }}
            size="sm"
            variant="outline"
            className="h-9 w-9 p-0 bg-white shadow-none border-gray-200"
            title="Reset filters"
            disabled={!(search || statusFilter !== "all" || selectedRoles.length !== 1 || selectedRoles[0] !== "acsl_agent" || dateFrom || dateTo)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* KPI Stat Cards — 4-card grid (Track Performance style) */}
        {(() => {
          

          const roleCounts: Record<string, number> = { ...roleTotals };
          delete roleCounts.partner;
          delete roleCounts.admin;
          delete roleCounts.super_admin;
          const roleEntries = Object.entries(roleCounts)
            .filter(([, c]) => c > 0)
            .sort((a, b) => b[1] - a[1]);
          const totalsSum = roleEntries.reduce((acc, [, c]) => acc + c, 0);
          const totalAgents = totalsSum > 0 ? totalsSum : agents.length;
          const totalAssigned = stoveTotals?.assigned ?? 0;
          const totalSold = stoveTotals?.sold ?? 0;
          const totalUnsold = stoveTotals?.unsold ?? 0;
          const totalsReady = stoveTotals !== null;

          const cards: Array<{
            gradient: string;
            Icon: any;
            value: string;
            label: string;
            sub?: React.ReactNode;
            onClick?: () => void;
          }> = [
            {
              gradient: "from-[#194977] to-[#2563EB]",
              Icon: Users,
              value: totalAgents.toLocaleString(),
              label: "Total Agents",
              onClick: () => setShowAgentsListModal(true),
              sub: (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {roleEntries.map(([r, c]) => (
                    <span
                      key={r}
                      className="text-[10px] font-semibold bg-white/20 text-white px-1.5 py-0.5 rounded"
                    >
                      {ROLE_LABELS[r] || r}: {c}
                    </span>
                  ))}
                </div>
              ),
            },
            {
              gradient: "from-[#B45309] to-[#F59E0B]",
              Icon: Package,
              value: totalsReady ? totalAssigned.toLocaleString() : "—",
              label: "Assigned for Sale / Retrieval",
              sub: "Click to view stove IDs",
              onClick: () => setShowAssignedStovesModal(true),
            },
            {
              gradient: "from-[#047857] to-[#10B981]",
              Icon: TrendingUp,
              value: totalsReady ? totalSold.toLocaleString() : "—",
              label: "Stoves Sold / Retrieved",
              sub: "Click to view stove IDs",
              onClick: () => setShowSoldStovesModal(true),
            },
            {
              gradient: "from-[#7C3AED] to-[#A78BFA]",
              Icon: Boxes,
              value: totalsReady ? totalUnsold.toLocaleString() : "—",
              label: "Unsold / Unretrieved Stoves",
              sub: "Click to view stove IDs",
              onClick: () => setShowUnsoldStovesModal(true),
            },
          ];

          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cards.map(({ gradient, Icon, value, label, sub, onClick }) => (
                <div
                  key={label}
                  onClick={onClick}
                  role={onClick ? "button" : undefined}
                  tabIndex={onClick ? 0 : undefined}
                  onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
                  className={`relative overflow-hidden rounded-lg border-transparent px-4 py-4 shadow-md transition-all bg-gradient-to-br ${gradient} ${onClick ? "cursor-pointer hover:shadow-lg hover:-translate-y-0.5" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-2xl font-bold text-white tracking-tight leading-tight">{value}</p>
                      <p className="text-sm font-semibold text-white/90 mt-1">{label}</p>
                      {typeof sub === "string" ? (
                        <p className="text-xs text-white/70 mt-0.5">{sub}</p>
                      ) : (
                        sub
                      )}
                    </div>
                    <div className="rounded-lg p-2 bg-white/20 text-white shadow-sm w-fit shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchAgents} className="ml-auto">
              Retry
            </Button>
          </div>
        )}

        {/* Monthly Records Collection Chart */}
        <AgentRecordsChart title="Records Collected" tooltipLabel="Collected" />

        {/* Active filter banner */}
        {sortMode !== "default" && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-lg text-xs text-primary">
            <span className="font-semibold">
              {sortMode === "most_received" && "Sorted by: Most Stoves Collected"}
              {sortMode === "most_sold" && "Sorted by: Total Stoves Sold"}
              {sortMode === "active_agents" && `Filtered to: Active Agents (${sortedAgents.length} of ${agents.length})`}
              {sortMode === "most_active_state" && `Filtered to: Agents in ${kpiStats.mostActiveState ?? "most active state"}`}
              {sortMode === "active_partners" && "Sorted by: Most Partners"}
            </span>
            <button onClick={() => setSortMode("default")} className="ml-auto flex items-center gap-1 hover:text-primary/70">
              <X className="h-3 w-3" />Clear
            </button>
          </div>
        )}

        {/* Table */}
        <div className="space-y-0">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-sm text-gray-600">
              Showing <span className="font-medium">{startItem}</span> to{" "}
              <span className="font-medium">{endItem}</span> of{" "}
              <span className="font-medium">{totalItems.toLocaleString()}</span> agents
            </p>
          </div>
          <div className="bg-white border-x border-t border-gray-200 rounded-t-lg overflow-x-auto relative">

            {loading && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#4a5d0f]" />
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow style={{ backgroundColor: "#4a5d0f" }} className="hover:bg-transparent">
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Full Name</TableHead>
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Phone Number</TableHead>
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                    <button type="button" onClick={() => cycleStoveSort("partners")} className="inline-flex items-center gap-1 hover:underline">
                      Partners Assigned <StoveSortIcon col="partners" />
                    </button>
                  </TableHead>
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                    <button type="button" onClick={() => cycleStoveSort("assigned")} className="inline-flex items-center gap-1 hover:underline">
                      Records to collect <StoveSortIcon col="assigned" />
                    </button>
                  </TableHead>
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                    <button type="button" onClick={() => cycleStoveSort("collected")} className="inline-flex items-center gap-1 hover:underline">
                      Records collected <StoveSortIcon col="collected" />
                    </button>
                  </TableHead>
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                    <button type="button" onClick={() => cycleStoveSort("in_stock")} className="inline-flex items-center gap-1 hover:underline">
                      Records not collected <StoveSortIcon col="in_stock" />
                    </button>
                  </TableHead>
                  
                </TableRow>
              </TableHeader>
              <TableBody className={loading ? "opacity-40" : ""}>
                {!loading && sortedAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 font-medium">
                        {sortMode !== "default" ? "No agents match the active filter" : "No agents found"}
                      </p>
                      {sortMode !== "default" ? (
                        <button onClick={() => setSortMode("default")} className="text-primary text-sm underline mt-1">Clear filter</button>
                      ) : (
                        <p className="text-gray-400 text-sm">Click "Create Agent" to add one.</p>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedAgents.map((agent, idx) => (
                    <TableRow
                      key={agent.id}
                      className="hover:bg-[#eef3c4] text-gray-700"
                      style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                    >
                      <TableCell className="text-sm font-medium text-gray-900">
                        <span>{agent.full_name}</span>
                        <sup className="ml-0.5 text-[9px] text-[#4a5d0f] font-semibold">
                          {AGENTS_PERFORMANCE_ROLE_LABELS[agent.role] || agent.role}
                        </sup>
                      </TableCell>
                      <TableCell className="text-sm text-gray-700">
                        {agent.phone || ""}
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => setPartnersModalAgent(agent)}
                          disabled={(agent.assigned_organizations_count ?? 0) === 0}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          title="View assigned partners"
                        >
                          {(agent.assigned_organizations_count ?? 0).toLocaleString()}
                        </button>
                      </TableCell>
                      {/* Stoves split into 3 columns — clickable pills like Partners Performance report */}
                      <TableCell className="text-center">
                        {agent.stove_summary ? (
                          <button
                            type="button"
                            onClick={() => setRowStoveModal({ agent, mode: "assigned" })}
                            disabled={agent.stove_summary.received === 0 || !(agent.direct_org_ids && agent.direct_org_ids.length)}
                            className="inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Records to collect"
                          >
                            {agent.stove_summary.received.toLocaleString()}
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {agent.stove_summary ? (
                          <button
                            type="button"
                            onClick={() => setRowStoveModal({ agent, mode: "sold" })}
                            disabled={agent.stove_summary.sold === 0 || !(agent.direct_org_ids && agent.direct_org_ids.length)}
                            className="inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Records collected"
                          >
                            {agent.stove_summary.sold.toLocaleString()}
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {agent.stove_summary ? (
                          <button
                            type="button"
                            onClick={() => setRowStoveModal({ agent, mode: "unsold" })}
                            disabled={agent.stove_summary.available === 0 || !(agent.direct_org_ids && agent.direct_org_ids.length)}
                            className="inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Records not collected"
                          >
                            {agent.stove_summary.available.toLocaleString()}
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-8 w-[72px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setPage(1)} disabled={page === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />Prev
              </Button>
              {getPageNumbers().map((p) => (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className={`h-8 w-8 p-0 ${p === page ? "bg-[#4a5d0f] text-white hover:bg-[#4a5d0f]" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {agentFormMode && (
        <AgentFormModal
          mode={agentFormMode}
          agent={agentFormMode === "edit" ? (selectedAgent ?? undefined) : undefined}
          onClose={() => { setAgentFormMode(null); setSelectedAgent(null); }}
          onSuccess={async (result) => {
            const wasCreate = agentFormMode === "create";
            setAgentFormMode(null);
            setSelectedAgent(null);
            toast({
              variant: "success",
              title: wasCreate
                ? `Agent "${result.full_name}" created successfully`
                : `Agent "${result.full_name}" updated`,
            });
            fetchAgents();
            if (wasCreate && result.id) {
              try {
                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const token = await tokenManager.getValidToken();
                const res = await fetch(`${supabaseUrl}/functions/v1/manage-credentials?user_id=${result.id}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                const json = await res.json();
                if (json.success && json.data) {
                  setNewAgentCredentials({ name: result.full_name, email: json.data.email, password: json.data.password });
                  setShowNewCredentialModal(true);
                }
              } catch { /* non-blocking */ }
            }
          }}
        />
      )}
      {showDeleteModal && selectedAgent && (
        <DeleteSuperAdminAgentModal
          agent={selectedAgent}
          onClose={() => { setShowDeleteModal(false); setSelectedAgent(null); }}
          onSuccess={() => {
            setShowDeleteModal(false);
            setSelectedAgent(null);
            toast({ variant: "success", title: "Agent deleted successfully" });
            fetchAgents();
          }}
        />
      )}
      {showViewModal && selectedAgent && (
        <ViewSuperAdminAgentModal
          agent={selectedAgent}
          onClose={() => { setShowViewModal(false); setSelectedAgent(null); }}
        />
      )}
      {showAssignModal && selectedAgent && (
        <AssignOrganizationsModal
          agent={selectedAgent}
          onClose={() => { setShowAssignModal(false); setSelectedAgent(null); }}
          onSuccess={() => {
            setShowAssignModal(false);
            toast({ variant: "success", title: "Assignments updated" });
            fetchAgents();
          }}
        />
      )}

      {/* View credentials modal */}
      <AgentViewCredentialModal
        isOpen={showCredentialModal}
        onClose={() => { setShowCredentialModal(false); setCredentialData(null); setSelectedAgent(null); }}
        credential={credentialData}
        agentName={selectedAgent?.full_name}
        canResetPassword
      />

      {/* New agent credentials modal (shown after creation) */}
      <AgentCredentialsModal
        isOpen={showNewCredentialModal}
        onClose={() => { setShowNewCredentialModal(false); setNewAgentCredentials(null); }}
        credentials={newAgentCredentials}
      />

      <AgentPartnersModal
        agent={partnersModalAgent}
        isOpen={!!partnersModalAgent}
        onClose={() => setPartnersModalAgent(null)}
      />

      <AgentStatesModal
        agent={statesModalAgent}
        isOpen={!!statesModalAgent}
        onClose={() => setStatesModalAgent(null)}
      />

      <AssignPartnerModal
        agent={assignPartnerAgent}
        isOpen={!!assignPartnerAgent}
        onClose={() => setAssignPartnerAgent(null)}
        onSuccess={() => {
          setAssignPartnerAgent(null);
          toast({ variant: "success", title: "Partner assignments updated" });
          fetchAgents();
        }}
      />

      <StockModal isOpen={showStockModal} onClose={() => setShowStockModal(false)} />

      <ActivePartnersModal
        isOpen={showActivePartnersModal}
        onClose={() => setShowActivePartnersModal(false)}
        partnerIds={activePartnerIdsInRange}
        dateBadge={dateBadgeLabel}
      />

      <AssignedStovesModal
        isOpen={showAssignedStovesModal}
        onClose={() => setShowAssignedStovesModal(false)}
        orgIds={kpiAssignedOrgIds}
      />

      <StovesStatusModal
        isOpen={showSoldStovesModal}
        onClose={() => setShowSoldStovesModal(false)}
        orgIds={kpiAssignedOrgIds}
        mode="sold"
        title="Stoves Sold / Retrieved — Stove IDs"
        filenamePrefix="sold-stoves"
        showExport={true}
        agents={agents}
      />

      <StovesStatusModal
        isOpen={showUnsoldStovesModal}
        onClose={() => setShowUnsoldStovesModal(false)}
        orgIds={kpiAssignedOrgIds}
        mode="unsold"
        title="Unsold / Unretrieved Stoves — Stove IDs"
        filenamePrefix="unsold-stoves"
        showExport={true}
        agents={agents}
      />

      {/* Row-level per-agent modals for Records to collect / collected / not collected */}
      {rowStoveModal && rowStoveModal.mode === "assigned" && (
        <AssignedStovesModal
          isOpen={true}
          onClose={() => setRowStoveModal(null)}
          orgIds={rowStoveModal.agent.direct_org_ids || []}
        />
      )}
      {rowStoveModal && rowStoveModal.mode === "sold" && (
        <StovesStatusModal
          isOpen={true}
          onClose={() => setRowStoveModal(null)}
          orgIds={rowStoveModal.agent.direct_org_ids || []}
          mode="sold"
          title={`Records collected — ${rowStoveModal.agent.full_name}`}
          filenamePrefix={`records-collected-${rowStoveModal.agent.full_name.replace(/\s+/g, "_")}`}
          showExport={true}
          agents={[{ id: rowStoveModal.agent.id, full_name: rowStoveModal.agent.full_name }]}
        />
      )}
      {rowStoveModal && rowStoveModal.mode === "unsold" && (
        <StovesStatusModal
          isOpen={true}
          onClose={() => setRowStoveModal(null)}
          orgIds={rowStoveModal.agent.direct_org_ids || []}
          mode="unsold"
          title={`Records not collected — ${rowStoveModal.agent.full_name}`}
          filenamePrefix={`records-not-collected-${rowStoveModal.agent.full_name.replace(/\s+/g, "_")}`}
          showExport={true}
          agents={[{ id: rowStoveModal.agent.id, full_name: rowStoveModal.agent.full_name }]}
        />
      )}


      <AgentsListModal
        isOpen={showAgentsListModal}
        onClose={() => setShowAgentsListModal(false)}
        agents={agents}
      />



      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </DashboardLayout>
  );
}

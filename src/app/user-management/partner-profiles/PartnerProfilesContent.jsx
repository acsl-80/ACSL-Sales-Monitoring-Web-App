import { useState, useEffect, useMemo } from "react";
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
  Building2,
  SquarePen,
  Eye,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Users,
  Mail,
  Phone,
  Package,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PageHeader from "../../components/PageHeader";
import { usePermissions } from "../../hooks/usePermissions";
import { supabaseFunctionsUrl } from "@/lib/supabaseConfig";
import { useToast, ToastContainer } from "@/components/ui/toast";
import PartnerDetailModal from "../../partners/components/PartnerDetailModal";
import EditPartnerModal from "../../partners/components/EditPartnerModal";
import ViewCredentialModal from "../../admin/components/credentials/ViewCredentialModal";
import adminCredentialsService from "../../services/adminCredentialsService";
import superAdminAgentService from "../../services/superAdminAgentService";
import adminAgentService from "../../services/adminAgentService.jsx";
import { createClientComponentClient } from "@/lib/supabaseClient";
import { getAgentIdsForPartner } from "../../services/agentAssignmentQueries";

const supabase = createClientComponentClient();


const ROLE_LABELS = {
  acsl_agent: "ACSL Agent",
  acsl_agent_manager: "ACSL Agent Manager",
  partner_agent: "Partner Agent",
  partner: "Partner",
};
const ROLE_BADGE = {
  acsl_agent: "bg-blue-100 text-blue-700",
  acsl_agent_manager: "bg-indigo-100 text-indigo-700",
  partner_agent: "bg-amber-100 text-amber-700",
  partner: "bg-emerald-100 text-emerald-700",
};
const formatRole = (r) => ROLE_LABELS[r] || (r ? r.replace(/_/g, " ") : "—");

// Fetch every agent (ACSL + partner agent) associated with an organization.
// ACSL agents come from the shared assignment-query helper so the count and
// list always match the Agents Profile view. Partner agents come from the
// profiles table via org membership.
async function fetchAllAgentsForOrg(orgId) {
  const acslIds = await getAgentIdsForPartner(orgId);

  let acslList = [];
  if (acslIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone, role")
      .in("id", acslIds);
    const byId = new Map((data || []).map((a) => [a.id, a]));

    // For any ids the profiles query couldn't return (typically blocked by
    // RLS for non-admin viewers), fall back to the manage-users edge
    // function which runs with elevated privileges.
    const missing = acslIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      try {
        const [{ supabaseFunctionsUrl }, tokenModule] = await Promise.all([
          import("@/lib/supabaseConfig"),
          import("@/utils/tokenManager"),
        ]);
        const token = await tokenModule.default.getValidToken();
        const qs = new URLSearchParams({ page: "1", limit: "5000" });
        const res = await fetch(`${supabaseFunctionsUrl}/manage-users?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          for (const u of json.data || []) {
            if (missing.includes(u.id) && !byId.has(u.id)) {
              byId.set(u.id, {
                id: u.id,
                full_name: u.full_name || u.name || u.email || "Unknown agent",
                email: u.email || "",
                phone: u.phone ?? "",
                role: u.role || "acsl_agent",
              });
            }
          }
        }
      } catch (_e) {
        // Silent fallback — keep placeholder rows below
      }
    }

    acslList = acslIds.map((id) => {
      const p = byId.get(id);
      return p
        ? { ...p, role: p.role || "acsl_agent" }
        : { id, full_name: "Unknown agent", email: "", phone: "", role: "acsl_agent" };
    });
  }


  // Partner agents belonging to this organization
  const { data: partnerAgents } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .eq("organization_id", orgId)
    .in("role", ["partner_agent", "agent"]);
  const partnerList = (partnerAgents || []).map((a) => ({ ...a, role: a.role || "partner_agent" }));

  const merged = [...acslList, ...partnerList];
  const seen = new Set();
  return merged.filter((a) => {
    const k = a.id || a.email;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}


const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const PartnerProfilesContent = () => {
  const { toast, toasts, removeToast } = useToast();
  const { can } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [partners, setPartners] = useState([]);
  const [filters, setFilters] = useState({ search: "", state: "", agentFilter: "" });
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);


  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
    setPage(1);
  };

  const [detailsPartner, setDetailsPartner] = useState(null);
  const [editingPartner, setEditingPartner] = useState(null);
  const [viewingCredential, setViewingCredential] = useState(null);
  const [loadingCredentialOrgId, setLoadingCredentialOrgId] = useState(null);
  const [agentCounts, setAgentCounts] = useState({}); // orgId -> count
  const [agentsModalPartner, setAgentsModalPartner] = useState(null);
  const [agentsModalList, setAgentsModalList] = useState([]);
  const [agentsModalLoading, setAgentsModalLoading] = useState(false);
  const [stoveCounts, setStoveCounts] = useState({}); // orgId -> total received
  const [stovesModalPartner, setStovesModalPartner] = useState(null);
  const [stovesModalList, setStovesModalList] = useState([]);
  const [stovesModalLoading, setStovesModalLoading] = useState(false);
  const [stovesModalSearch, setStovesModalSearch] = useState("");

  const openAgentsModal = async (partner) => {
    setAgentsModalPartner(partner);
    setAgentsModalLoading(true);
    setAgentsModalList([]);
    try {
      const list = await fetchAllAgentsForOrg(partner.id);
      setAgentsModalList(list);
      setAgentCounts((prev) => ({ ...prev, [partner.id]: list.length }));
    } catch (err) {
      toast({ variant: "error", title: "Failed to load agents", description: err.message });
    } finally {
      setAgentsModalLoading(false);
    }
  };

  const openStovesModal = async (partner) => {
    setStovesModalPartner(partner);
    setStovesModalLoading(true);
    setStovesModalList([]);
    setStovesModalSearch("");
    try {
      const { data, error } = await supabase
        .from("stove_ids_base")
        .select("id, stove_id, status, created_at")
        .eq("organization_id", partner.id)
        .eq("is_archived", false)
        .order("stove_id", { ascending: true });
      if (error) throw error;
      const list = data || [];
      setStovesModalList(list);
      setStoveCounts((prev) => ({ ...prev, [partner.id]: list.length }));
    } catch (err) {
      toast({ variant: "error", title: "Failed to load stoves", description: err.message });
    } finally {
      setStovesModalLoading(false);
    }
  };



  // Single fetch path for every role: manage-organizations enforces row
  // scoping server-side (all partners for super_admin, assigned partners
  // for ACSL agents/managers) and returns an identical shape.
  const loadPartners = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const limit = 100;
      let offset = 0;
      let total = Infinity;
      const all = [];
      while (offset < total) {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          include_admin_users: "false",
          sortBy: "partner_name",
          sortOrder: "asc",
        });
        const res = await fetch(`${supabaseFunctionsUrl}/manage-organizations?${params}`, { headers });
        const result = await res.json();
        if (!res.ok || result.success === false) {
          throw new Error(result.error || result.message || "Failed to load partners");
        }
        const rows = result.data || [];
        all.push(...rows);
        total = result.pagination?.total ?? all.length;
        offset += limit;
        if (rows.length === 0) break;
      }
      setPartners(all);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load partners", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPartners();
  }, []);

  // Refresh agent counts when an assignment is added / changed elsewhere in
  // the app (e.g. the ACSL Agents assign-partners modal). Clearing the cache
  // triggers the lazy-fetch effect for the visible page.
  useEffect(() => {
    const handler = () => {
      setAgentCounts({});
    };
    window.addEventListener("acsl:user-updated", handler);
    window.addEventListener("acsl:assignment-updated", handler);
    return () => {
      window.removeEventListener("acsl:user-updated", handler);
      window.removeEventListener("acsl:assignment-updated", handler);
    };
  }, []);

  const handleViewCredentials = async (org) => {
    setLoadingCredentialOrgId(org.id);
    try {
      const res = await adminCredentialsService.getCredentialByPartnerId(org.partner_id);
      if (res.success && res.data) {
        setViewingCredential(res.data);
      } else {
        toast({ variant: "error", title: "No credentials found", description: res.error || "This partner has no credentials." });
      }
    } catch (err) {
      toast({ variant: "error", title: "Error", description: err.message });
    } finally {
      setLoadingCredentialOrgId(null);
    }
  };

  const states = useMemo(() => {
    const s = new Set();
    partners.forEach((p) => p.state && s.add(p.state));
    return Array.from(s).sort();
  }, [partners]);

  const filtered = useMemo(() => {
    const list = partners.filter((p) => {
      if (filters.state && p.state !== filters.state) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${p.partner_name ?? ""} ${p.branch ?? ""} ${p.contact_phone ?? ""} ${p.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.agentFilter) {
        const count = agentCounts[p.id];
        if (count === undefined) return false;
        if (filters.agentFilter === "assigned" && count === 0) return false;
        if (filters.agentFilter === "unassigned" && count > 0) return false;
      }
      return true;
    });

    if (!sortConfig.key) return list;

    const dir = sortConfig.direction === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortConfig.key === "partner") {
        const av = (a.partner_name || "").toLowerCase();
        const bv = (b.partner_name || "").toLowerCase();
        return av.localeCompare(bv) * dir;
      }
      if (sortConfig.key === "assigned_agents") {
        const av = agentCounts[a.id];
        const bv = agentCounts[b.id];
        if (av === undefined && bv === undefined) return (a.partner_name || "").localeCompare(b.partner_name || "");
        if (av === undefined) return 1;   // unloaded rows always at the bottom
        if (bv === undefined) return -1;
        if (av === bv) return (a.partner_name || "").localeCompare(b.partner_name || "");
        return (av - bv) * dir;
      }
      if (sortConfig.key === "total_stoves") {
        const av = stoveCounts[a.id];
        const bv = stoveCounts[b.id];
        if (av === undefined && bv === undefined) return (a.partner_name || "").localeCompare(b.partner_name || "");
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        if (av === bv) return (a.partner_name || "").localeCompare(b.partner_name || "");
        return (av - bv) * dir;
      }

      return 0;
    });
  }, [partners, filters, agentCounts, stoveCounts, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const startRecord = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, filtered.length);


  // Fetch agent counts for currently visible partners (lazy, cached)
  useEffect(() => {
    const missing = pageRows.filter((p) => agentCounts[p.id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        missing.map(async (p) => {
          try {
            const list = await fetchAllAgentsForOrg(p.id);
            return [p.id, list.length];
          } catch {
            return [p.id, 0];
          }
        })
      );
      if (cancelled) return;
      setAgentCounts((prev) => {
        const next = { ...prev };
        results.forEach(([id, c]) => { next[id] = c; });
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [pageRows, agentCounts]);

  // Lazy fetch stove totals per visible partner
  useEffect(() => {
    const missing = pageRows.filter((p) => stoveCounts[p.id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = missing.map((p) => p.id);
      try {
        const counts = {};
        ids.forEach((id) => { counts[id] = 0; });
        const BATCH = 50;
        for (let i = 0; i < ids.length; i += BATCH) {
          const slice = ids.slice(i, i + BATCH);
          const { data } = await supabase
            .from("stove_ids_base")
            .select("organization_id")
            .in("organization_id", slice)
            .eq("is_archived", false);
          (data || []).forEach((r) => {
            counts[r.organization_id] = (counts[r.organization_id] || 0) + 1;
          });
        }
        if (cancelled) return;
        setStoveCounts((prev) => ({ ...prev, ...counts }));
      } catch {
        if (!cancelled) {
          setStoveCounts((prev) => {
            const next = { ...prev };
            ids.forEach((id) => { if (next[id] === undefined) next[id] = 0; });
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pageRows, stoveCounts]);

  // Eagerly fetch agent counts for all partners when filtering OR sorting by agent count.
  // Without this, sort-by-assigned-agents keeps re-ordering as lazy per-page fetches land,
  // which pulls new rows onto the page, triggers more fetches, and makes the table "act up".
  useEffect(() => {
    const needAll = Boolean(filters.agentFilter) || sortConfig.key === "assigned_agents";
    if (!needAll || partners.length === 0) return;
    const missing = partners.filter((p) => agentCounts[p.id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const BATCH = 20;
      for (let i = 0; i < missing.length; i += BATCH) {
        if (cancelled) return;
        const slice = missing.slice(i, i + BATCH);
        const results = await Promise.all(
          slice.map(async (p) => {
            try {
              const list = await fetchAllAgentsForOrg(p.id);
              return [p.id, list.length];
            } catch {
              return [p.id, 0];
            }
          })
        );
        if (cancelled) return;
        setAgentCounts((prev) => {
          const next = { ...prev };
          results.forEach(([id, c]) => { next[id] = c; });
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [filters.agentFilter, sortConfig.key, partners, agentCounts]);

  // Eagerly fetch stove counts for all partners when sorting by that column, same reason.
  useEffect(() => {
    if (sortConfig.key !== "total_stoves" || partners.length === 0) return;
    const missing = partners.filter((p) => stoveCounts[p.id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = missing.map((p) => p.id);
      try {
        const counts = {};
        ids.forEach((id) => { counts[id] = 0; });
        const BATCH = 50;
        for (let i = 0; i < ids.length; i += BATCH) {
          if (cancelled) return;
          const slice = ids.slice(i, i + BATCH);
          const { data } = await supabase
            .from("stove_ids_base")
            .select("organization_id")
            .in("organization_id", slice)
            .eq("is_archived", false);
          (data || []).forEach((r) => {
            counts[r.organization_id] = (counts[r.organization_id] || 0) + 1;
          });
        }
        if (cancelled) return;
        setStoveCounts((prev) => ({ ...prev, ...counts }));
      } catch {
        // ignore; lazy per-page effect will retry
      }
    })();
    return () => { cancelled = true; };
  }, [sortConfig.key, partners, stoveCounts]);


  const hasActiveFilters = filters.search !== "" || filters.state !== "" || filters.agentFilter !== "";


  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({ search: "", state: "", agentFilter: "" });
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
      <PageHeader icon={Building2} title="Partner Profiles" />

      {/* Filter Bar */}
      <div
        className="p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3"
        style={{ backgroundColor: "#f4f7e3" }}
      >
        <div className="w-1/4 min-w-[180px]">
          <Input
            placeholder="Search partner, branch, phone or email..."
            value={filters.search}
            onChange={(e) => handleFilterChange("search", e.target.value)}
            className="bg-white h-9 text-xs shadow-none border-gray-200"
          />
        </div>

        <Select
          value={filters.state || "all"}
          onValueChange={(v) => handleFilterChange("state", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[170px] h-9 bg-white text-xs shadow-none border-gray-200 text-gray-400 data-[placeholder]:text-gray-400">
            <SelectValue placeholder="All States" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all" className="text-xs">All States</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.agentFilter || "all"}
          onValueChange={(v) => handleFilterChange("agentFilter", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[200px] h-9 bg-white text-xs shadow-none border-gray-200 text-gray-400 data-[placeholder]:text-gray-400">
            <SelectValue placeholder="All Partners" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all" className="text-xs">All Partners</SelectItem>
            <SelectItem value="assigned" className="text-xs">With Assigned Agents</SelectItem>
            <SelectItem value="unassigned" className="text-xs">With No Agents</SelectItem>
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
          <span className="font-medium">{filtered.length}</span> partners
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
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap first:rounded-tl-lg cursor-pointer select-none" onClick={() => handleSort("partner")}>
                  <span className="inline-flex items-center gap-1">
                    Partner
                    {sortConfig.key === "partner" ? (
                      sortConfig.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                    )}
                  </span>
                </TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">State</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Branch</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Phone Number</TableHead>
                <TableHead className="text-center text-white font-semibold text-sm whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort("assigned_agents")}>
                  <span className="inline-flex items-center justify-center gap-1">
                    Assigned Agents
                    {sortConfig.key === "assigned_agents" ? (
                      sortConfig.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                    )}
                  </span>
                </TableHead>
                <TableHead className="text-center text-white font-semibold text-sm whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort("total_stoves")}>
                  <span className="inline-flex items-center justify-center gap-1">
                    Total Stoves Purchased
                    {sortConfig.key === "total_stoves" ? (
                      sortConfig.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                    )}
                  </span>
                </TableHead>
                <TableHead className="text-right text-white font-semibold text-sm whitespace-nowrap rounded-tr-lg">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-40" : ""}>
              {pageRows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-gray-500">
                    No partners found
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((p, idx) => (
                  <TableRow
                    key={p.id}
                    className="hover:bg-[#eef3c4] text-gray-700"
                    style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                  >

                    <TableCell className="text-sm font-medium text-gray-900">{p.partner_name || "N/A"}</TableCell>
                    <TableCell className="text-sm text-gray-600">{p.state || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600">{p.branch || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600">{p.contact_phone || "—"}</TableCell>
                    <TableCell className="text-center">
                      {agentCounts[p.id] === undefined ? (
                        <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </span>
                      ) : agentCounts[p.id] > 0 ? (
                        <button
                          type="button"
                          onClick={() => openAgentsModal(p)}
                          className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 transition cursor-pointer"
                          title="View assigned agents"
                        >
                          {agentCounts[p.id]}
                        </button>
                      ) : (
                        <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                          0
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {stoveCounts[p.id] === undefined ? (
                        <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </span>
                      ) : stoveCounts[p.id] > 0 ? (
                        <button
                          type="button"
                          onClick={() => openStovesModal(p)}
                          className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 transition cursor-pointer"
                          title="View all stove IDs"
                        >
                          {stoveCounts[p.id].toLocaleString()}
                        </button>
                      ) : (
                        <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                          0
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setDetailsPartner(p)}
                                aria-label="View details"
                                className="inline-flex items-center justify-center h-8 px-3 bg-slate-700 text-white text-xs font-medium shadow-sm hover:bg-slate-800 active:scale-[0.98] transition"
                              >
                                Details
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>View partner details</TooltipContent>
                          </Tooltip>

                          {can("credentials") && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => handleViewCredentials(p)}
                                disabled={loadingCredentialOrgId === p.id}
                                aria-label="Credentials"
                                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 bg-indigo-600 text-white text-xs font-medium shadow-sm hover:bg-indigo-700 active:scale-[0.98] transition disabled:opacity-60"
                              >
                                {loadingCredentialOrgId === p.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                Credentials
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>View login credentials</TooltipContent>
                          </Tooltip>
                          )}

                          {can("edit-any-partner") && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setEditingPartner(p)}
                                aria-label="Edit partner"
                                className="inline-flex items-center justify-center h-8 px-3 bg-orange-500 text-white text-xs font-medium shadow-sm hover:bg-orange-600 active:scale-[0.98] transition"
                              >
                                Edit
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Edit partner</TooltipContent>
                          </Tooltip>
                          )}
                        </TooltipProvider>
                      </div>

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
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">{startRecord}</span> to{" "}
                <span className="font-medium">{endRecord}</span> of{" "}
                <span className="font-medium">{filtered.length}</span> partners
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Rows per page</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                >
                  <SelectTrigger className="h-8 w-[72px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-sm">{n}</SelectItem>
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
                    className={`h-8 w-8 p-0 ${p === currentPage ? "bg-brand text-white hover:bg-brand" : ""}`}
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

      <PartnerDetailModal
        organization={detailsPartner}
        isOpen={!!detailsPartner}
        onClose={() => setDetailsPartner(null)}
      />


      <EditPartnerModal
        organization={editingPartner}
        isOpen={!!editingPartner}
        onClose={() => setEditingPartner(null)}
        onSuccess={() => {
          setEditingPartner(null);
          loadPartners();
        }}
      />

      <ViewCredentialModal
        isOpen={!!viewingCredential}
        onClose={() => setViewingCredential(null)}
        credential={viewingCredential}
      />

      <Dialog open={!!agentsModalPartner} onOpenChange={(o) => !o && setAgentsModalPartner(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4" style={{ backgroundColor: "#4a5d0f" }}>
            <DialogTitle className="text-white flex items-center gap-2 text-base">
              <Users className="h-5 w-5" />
              Assigned Agents
            </DialogTitle>
            {agentsModalPartner && (
              <p className="text-white/80 text-xs mt-1">
                {agentsModalPartner.partner_name}
                {agentsModalPartner.branch ? ` — ${agentsModalPartner.branch}` : ""}
              </p>
            )}
          </DialogHeader>
          <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
            {agentsModalLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading agents...
              </div>
            ) : agentsModalList.length === 0 ? (
              <div className="text-center py-10 text-gray-500 text-sm">No agents assigned.</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{agentsModalList.length}</span> agent{agentsModalList.length === 1 ? "" : "s"} assigned
                  </p>
                </div>
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                  {agentsModalList.map((a, i) => (
                    <li
                      key={a.id || i}
                      className="px-4 py-3 flex items-center gap-3"
                      style={{ backgroundColor: i % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                    >
                      <div className="h-9 w-9 rounded-full bg-[#4a5d0f] text-white flex items-center justify-center text-sm font-semibold shrink-0">
                        {(a.full_name || a.email || "?").trim().charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-900 truncate">{a.full_name || "—"}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${ROLE_BADGE[a.role] || "bg-gray-100 text-gray-700"}`}>
                            {formatRole(a.role)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-0.5 text-xs text-gray-600">
                          <span className="inline-flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 text-gray-400" />
                            {a.email || "—"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3 text-gray-400" />
                            {a.phone || "—"}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!stovesModalPartner} onOpenChange={(o) => !o && setStovesModalPartner(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4" style={{ backgroundColor: "#4a5d0f" }}>
            <DialogTitle className="text-white flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              Stove IDs
            </DialogTitle>
            {stovesModalPartner && (
              <p className="text-white/80 text-xs mt-1">
                {stovesModalPartner.partner_name}
                {stovesModalPartner.branch ? ` — ${stovesModalPartner.branch}` : ""}
              </p>
            )}
          </DialogHeader>
          <div className="px-6 py-4 max-h-[65vh] overflow-y-auto">
            {stovesModalLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading stoves...
              </div>
            ) : stovesModalList.length === 0 ? (
              <div className="text-center py-10 text-gray-500 text-sm">No stoves assigned to this partner.</div>
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search stove ID or status..."
                    value={stovesModalSearch}
                    onChange={(e) => setStovesModalSearch(e.target.value)}
                    className="pl-8 h-9 text-xs bg-white border-gray-200"
                  />
                </div>
                {(() => {
                  const q = stovesModalSearch.trim().toLowerCase();
                  const filteredStoves = q
                    ? stovesModalList.filter(
                        (s) =>
                          (s.stove_id || "").toLowerCase().includes(q) ||
                          (s.status || "").toLowerCase().includes(q)
                      )
                    : stovesModalList;
                  return (
                    <>
                      <p className="text-xs text-gray-600 mb-2">
                        <span className="font-semibold text-gray-900">{filteredStoves.length}</span> of{" "}
                        <span className="font-semibold text-gray-900">{stovesModalList.length}</span> stove{stovesModalList.length === 1 ? "" : "s"}
                      </p>
                      {filteredStoves.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 text-sm">No matching stoves.</div>
                      ) : (
                        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                          {filteredStoves.map((s, i) => (
                            <li
                              key={s.id || s.stove_id || i}
                              className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                              style={{ backgroundColor: i % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                            >
                              <span className="font-mono text-gray-900 truncate">{s.stove_id || "—"}</span>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  s.status === "sold"
                                    ? "bg-blue-100 text-blue-700"
                                    : s.status === "available"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-gray-100 text-gray-700"
                                }`}
                              >
                                {s.status || "—"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
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

export default PartnerProfilesContent;

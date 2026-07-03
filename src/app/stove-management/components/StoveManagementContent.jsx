
import { supabaseFunctionsUrl } from "@/lib/supabaseConfig";
import { useState, useEffect, useRef, useCallback } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import { lgaAndStates } from "../../constants";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "../../contexts/useAuth";
import { usePermissions } from "../../hooks/usePermissions";
import { useToast, ToastContainer } from "@/components/ui/toast";
import {
  Loader2, Search, X, Package, CheckCircle, Building2,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Download, ArrowUp, ArrowDown,
} from "lucide-react";
import { downloadTableAsCSV } from "@/utils/csvExportUtils";
import AdminSalesDetailModal from "../../admin/components/sales/AdminSalesDetailModal";
import PageHeader from "../../components/PageHeader";
import superAdminAgentService from "../../services/superAdminAgentService";

const SimpleTooltip = ({ children, text }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>{children}</div>
      {show && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded whitespace-nowrap z-50">
          {text}
        </div>
      )}
    </div>
  );
};

export default function StoveManagementContent() {
  const { supabase, user, isSuperAdmin, isAdmin, isAcslAgent, getStoredProfile } = useAuth();
  const { can } = usePermissions();
  const { toast, toasts, removeToast } = useToast();

  const userProfile = getStoredProfile();
  const adminOrgId = userProfile?.organization_id || null;

  // ── Organisation cache (super admin / partner) ─────────────────────────────
  const ORG_CACHE_KEY = "stove_management_organizations_cache";
  const ORG_CACHE_TIMESTAMP_KEY = "stove_management_organizations_cache_timestamp";
  const CACHE_DURATION = 30 * 60 * 1000;

  const getCachedOrganizations = () => {
    try {
      const cached = localStorage.getItem(ORG_CACHE_KEY);
      const ts = localStorage.getItem(ORG_CACHE_TIMESTAMP_KEY);
      if (cached && ts && Date.now() - parseInt(ts) < CACHE_DURATION) return JSON.parse(cached);
    } catch {}
    return null;
  };
  const setCachedOrganizations = (data) => {
    try {
      localStorage.setItem(ORG_CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(ORG_CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch {}
  };

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [stoveIds, setStoveIds] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, page_size: 10, total_count: 0, total_pages: 0 });
  const [stats, setStats] = useState({ available: 0, sold: 0, total: 0 });
  const [loadingStats, setLoadingStats] = useState(false);

  // Super admin / partner: grouped org search
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgIds, setSelectedOrgIds] = useState(isAdmin && !isSuperAdmin && adminOrgId ? [adminOrgId] : []);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [orgSearch, setOrgSearch] = useState("");
  const [openOrgPopover, setOpenOrgPopover] = useState(false);
  const orgDropdownRef = useRef(null);

  // ACSL agent: assigned orgs only
  const [assignedOrgs, setAssignedOrgs] = useState([]);
  const [assignedOrgIds, setAssignedOrgIds] = useState([]);
  const [acslOrgFilter, setAcslOrgFilter] = useState("all");

  const [filters, setFilters] = useState({ stove_id: "", status: "", branch: "", state: "", date_from: "", date_to: "" });

  const [selectedSale, setSelectedSale] = useState(null);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [loadingStoveId, setLoadingStoveId] = useState(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [stoveToArchive, setStoveToArchive] = useState(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Super admin controls
  const [groupBy, setGroupBy] = useState("none");
  const [sortBy, setSortBy] = useState("status");
  const [sortDir, setSortDir] = useState("desc");

  // ── Close org dropdown on outside click ───────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target))
        setOpenOrgPopover(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Load assigned orgs for ACSL agent ─────────────────────────────────────
  useEffect(() => {
    if (!isAcslAgent || !user?.id) return;
    superAdminAgentService.getAgentOrganizations(user.id).then((r) => {
      const orgs = r.data || [];
      setAssignedOrgs(orgs);
      setAssignedOrgIds(orgs.map((o) => o.id));
    }).catch(() => {});
  }, [isAcslAgent, user?.id]);

  // ── Fetch all orgs (super admin / partner) ────────────────────────────────
  const fetchOrganizations = async (searchTerm = "") => {
    if (isAdmin && !isSuperAdmin) return;
    setLoadingOrgs(true);
    try {
      const cachedData = getCachedOrganizations();
      if (cachedData?.length > 0) {
        setOrganizations(searchTerm
          ? cachedData.filter((g) =>
              g.base_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              g.branches.some((b) =>
                b.branch.toLowerCase().includes(searchTerm.toLowerCase()) ||
                b.state?.toLowerCase().includes(searchTerm.toLowerCase())
              )
            )
          : cachedData);
        setLoadingOrgs(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${supabaseFunctionsUrl}/get-organizations-grouped?page=1&page_size=500`,
        { headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
      );
      const result = await response.json();
      const fetchedData = result.data || [];
      setCachedOrganizations(fetchedData);
      setOrganizations(searchTerm ? fetchedData.filter((g) => g.base_name.toLowerCase().includes(searchTerm.toLowerCase())) : fetchedData);
    } catch {
      setOrganizations([]);
    } finally {
      setLoadingOrgs(false);
    }
  };

  // ── Fetch stats — plain async, all values passed explicitly ─────────────
  const fetchStats = async (orgIds) => {
    setLoadingStats(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const params = new URLSearchParams();
      if (orgIds?.length > 0) params.append("organization_ids", orgIds.join(","));
      const response = await fetch(
        `${supabaseFunctionsUrl}/get-stove-stats?${params}`,
        { headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
      );
      const result = await response.json();
      setStats(result.data || { available: 0, sold: 0, total: 0 });
    } catch {
      setStats({ available: 0, sold: 0, total: 0 });
    } finally {
      setLoadingStats(false);
    }
  };

  // ── Fetch stove IDs — plain async, ALL values passed as explicit params ──
  // No closures over role/filter state — callers pass current values directly.
  const fetchStoveIds = async (
    page,
    pageSize,
    currentFilters,
    orgIds,
    archived,
    currentSortBy,
    currentSortDir,
    acslMode,          // true = ACSL agent path
    acslFilter,        // current acslOrgFilter value
    acslOrgList,       // current assignedOrgIds
  ) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setLoading(false); return; }

      const params = new URLSearchParams({
        page: (page || 1).toString(),
        page_size: (pageSize || 10).toString(),
      });

      if (acslMode) {
        const scopedIds = acslFilter !== "all" ? [acslFilter] : acslOrgList;
        if (scopedIds.length > 0) params.append("organization_ids", scopedIds.join(","));
      } else if (orgIds?.length > 0) {
        params.append("organization_ids", orgIds.join(","));
      }

      if (currentFilters?.stove_id) params.append("stove_id", currentFilters.stove_id);
      if (currentFilters?.status) params.append("status", currentFilters.status);
      if (currentFilters?.branch) params.append("branch", currentFilters.branch);
      if (currentFilters?.state) params.append("state", currentFilters.state);
      if (currentFilters?.date_from) params.append("date_from", currentFilters.date_from);
      if (currentFilters?.date_to) params.append("date_to", currentFilters.date_to);
      if (archived) params.append("show_archived", "true");
      if (!acslMode && currentSortBy && currentSortBy !== "organization") params.append("sort_by", currentSortBy);
      if (!acslMode) params.append("sort_dir", currentSortDir || "desc");

      const response = await fetch(
        `${supabaseFunctionsUrl}/manage-stove-ids?${params}`,
        { headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch stove IDs");
      setStoveIds(result.data || []);
      setPagination(result.pagination || { page: 1, page_size: 25, total_count: 0, total_pages: 0 });
    } catch (err) {
      if (!acslMode) toast({ variant: "error", title: "Failed to fetch stove IDs", description: err.message });
      setStoveIds([]);
    } finally {
      setLoading(false);
    }
  };

  // Helper: call fetchStoveIds with current component state
  const fetchStoveIdsCurrent = (page = 1) =>
    fetchStoveIds(page, pagination.page_size, filters, selectedOrgIds, showArchived, sortBy, sortDir, isAcslAgent, acslOrgFilter, assignedOrgIds);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAcslAgent) return; // ACSL uses the assignedOrgIds effect below

    const cached = getCachedOrganizations();
    if (cached?.length > 0) setOrganizations(cached);
    else fetchOrganizations();

    fetchStats(isAdmin && !isSuperAdmin && adminOrgId ? [adminOrgId] : []);
    fetchStoveIds(1, 10, filters, selectedOrgIds, showArchived, sortBy, sortDir, false, "all", []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ACSL: fire once assigned orgs are loaded ──────────────────────────────
  useEffect(() => {
    if (!isAcslAgent || assignedOrgIds.length === 0) return;
    fetchStoveIds(1, pagination.page_size, filters, selectedOrgIds, false, sortBy, sortDir, true, acslOrgFilter, assignedOrgIds);
    fetchStats(assignedOrgIds);
  }, [assignedOrgIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ACSL: re-fetch when their filters change ──────────────────────────────
  useEffect(() => {
    if (!isAcslAgent || assignedOrgIds.length === 0) return;
    fetchStoveIds(1, pagination.page_size, filters, selectedOrgIds, false, sortBy, sortDir, true, acslOrgFilter, assignedOrgIds);
  }, [acslOrgFilter, filters.stove_id, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSelectOrganization = (orgIds) => {
    setSelectedOrgIds(orgIds);
    fetchStats(orgIds);
    fetchStoveIds(1, pagination.page_size, filters, orgIds, showArchived, sortBy, sortDir, isAcslAgent, acslOrgFilter, assignedOrgIds);
  };

  const getSelectedOrgName = () => {
    if (!selectedOrgIds?.length) return "All Organizations";
    for (const group of organizations) {
      if (selectedOrgIds.length === group.organization_ids.length && selectedOrgIds.every((id) => group.organization_ids.includes(id)))
        return `${group.base_name} (All Branches)`;
      const branch = group.branches.find((b) => selectedOrgIds.includes(b.id) && selectedOrgIds.length === 1);
      if (branch) return `${group.base_name} - ${branch.branch}`;
    }
    return `${selectedOrgIds.length} selected`;
  };

  const handlePageChange = (newPage) =>
    fetchStoveIds(newPage, pagination.page_size, filters, selectedOrgIds, showArchived, sortBy, sortDir, isAcslAgent, acslOrgFilter, assignedOrgIds);
  const handlePageSizeChange = (newSize) => {
    const size = parseInt(newSize);
    setPagination((prev) => ({ ...prev, page_size: size }));
    fetchStoveIds(1, size, filters, selectedOrgIds, showArchived, sortBy, sortDir, isAcslAgent, acslOrgFilter, assignedOrgIds);
  };
  const handleFilterChange = (field, value) => {
    const newFilters = { ...filters, [field]: value };
    setFilters(newFilters);
    if (!isAcslAgent) fetchStoveIds(1, pagination.page_size, newFilters, selectedOrgIds, showArchived, sortBy, sortDir, false, acslOrgFilter, assignedOrgIds);
  };
  const handleClearFilters = () => {
    const cleared = { stove_id: "", status: "", branch: "", state: "", date_from: "", date_to: "" };
    setFilters(cleared);
    if (isAcslAgent) {
      setAcslOrgFilter("all");
    } else {
      if (isSuperAdmin) { handleSelectOrganization([]); setOrgSearch(""); const c = getCachedOrganizations(); if (c?.length) setOrganizations(c); }
      fetchStoveIds(1, pagination.page_size, cleared, selectedOrgIds, showArchived, sortBy, sortDir, false, acslOrgFilter, assignedOrgIds);
    }
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== "") ||
    (!isAcslAgent && isSuperAdmin && selectedOrgIds.length > 0) ||
    (isAcslAgent && acslOrgFilter !== "all") ||
    showArchived;

  const handleViewStove = async (stove) => {
    setLoadingStoveId(stove.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${supabaseFunctionsUrl}/manage-stove-ids?id=${stove.id}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch stove details");
      if (result.status === "sold") {
        const saleResponse = await fetch(
          `${supabaseFunctionsUrl}/get-sale?stove_serial_no=${result.stove_id}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        const saleResult = await saleResponse.json();
        if (saleResult.success && saleResult.data) { setSelectedSale(saleResult.data); setShowSaleModal(true); return; }
      }
      toast({ title: "Stove Info", description: `Stove ${result.stove_id} — Status: ${result.status}` });
    } catch (err) {
      toast({ variant: "error", title: "Failed to fetch stove details", description: err.message });
    } finally {
      setLoadingStoveId(null);
    }
  };

  const handleArchiveStove = async () => {
    if (!stoveToArchive) return;
    setArchiving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${supabaseFunctionsUrl}/manage-stove-ids`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive", id: stoveToArchive.id, note: archiveNote }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to archive stove ID");
      toast({ variant: "success", title: `Stove ID ${stoveToArchive.stove_id} archived successfully` });
      setShowArchiveModal(false);
      setStoveToArchive(null);
      setArchiveNote("");
      fetchStoveIds(pagination.page, pagination.page_size, filters, selectedOrgIds, showArchived, sortBy, sortDir, isAcslAgent, acslOrgFilter, assignedOrgIds);
      fetchStats(selectedOrgIds);
    } catch (err) {
      toast({ variant: "error", title: err.message });
    } finally {
      setArchiving(false);
    }
  };

  const handleSortByChange = (val) => {
    setSortBy(val);
    fetchStoveIds(1, pagination.page_size, filters, selectedOrgIds, showArchived, val, sortDir, isAcslAgent, acslOrgFilter, assignedOrgIds);
  };
  const toggleSortDir = () => {
    const newDir = sortDir === "asc" ? "desc" : "asc";
    setSortDir(newDir);
    fetchStoveIds(1, pagination.page_size, filters, selectedOrgIds, showArchived, sortBy, newDir, isAcslAgent, acslOrgFilter, assignedOrgIds);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    try { return new Date(dateString).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }); }
    catch { return "Invalid Date"; }
  };

  // ── Display rows (groupBy for super admin) ────────────────────────────────
  const displayRows = (() => {
    if (!isSuperAdmin || groupBy === "none") return stoveIds.map((s) => ({ type: "row", stove: s }));
    const getGroupKey = (s) => groupBy === "sales_reference" ? (s.sales_reference || "No Sales Reference") : (s.organization_name || "No Organization");
    const groups = [];
    const seen = new Map();
    for (const stove of stoveIds) {
      const key = getGroupKey(stove);
      if (!seen.has(key)) { seen.set(key, []); groups.push(key); }
      seen.get(key).push(stove);
    }
    const rows = [];
    for (const key of groups) {
      rows.push({ type: "group-header", label: key, count: seen.get(key).length });
      for (const stove of seen.get(key)) rows.push({ type: "row", stove });
    }
    return rows;
  })();

  const startRecord = pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const endRecord = Math.min(pagination.page * pagination.page_size, pagination.total_count);

  const getVisiblePages = () => {
    const pages = [];
    let start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.total_pages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  // Table column count for colspan
  const colSpan = isSuperAdmin ? 9 : isAcslAgent ? 6 : 7;

  return (
    <DashboardLayout currentRoute="stove-management" title="Track Stoves">
      <div className="p-6 space-y-5">
        <PageHeader
          icon={Package}
          title="Track Stoves"
        />


        {/* Filter Bar */}
        <div className="bg-[#f4f7e3] p-3 rounded-lg border border-gray-200">
          <div className="flex flex-wrap items-center gap-3">

            {/* Super admin: org search dropdown */}
            {isSuperAdmin && (
              <div className="relative w-[200px]" ref={orgDropdownRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search organizations..."
                  value={orgSearch}
                  onChange={(e) => { setOrgSearch(e.target.value); fetchOrganizations(e.target.value); setOpenOrgPopover(true); }}
                  onFocus={() => { setOpenOrgPopover(true); if (!orgSearch) { const c = getCachedOrganizations(); if (c?.length) setOrganizations(c); else fetchOrganizations(""); } }}
                  className="pl-9 bg-white h-9 text-sm"
                />
                {openOrgPopover && (
                  <div className="absolute z-50 min-w-[200px] max-w-[300px] mt-2 bg-white rounded-md border border-gray-200 shadow-md max-h-64 overflow-y-auto">
                    <div className="p-2">
                      {loadingOrgs ? (
                        <div className="px-2 py-4 text-sm text-center text-gray-500 flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                        </div>
                      ) : (
                        <>
                          <div className="px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100 rounded-sm flex items-center gap-2"
                            onClick={() => { handleSelectOrganization([]); setOrgSearch(""); setOpenOrgPopover(false); const c = getCachedOrganizations(); if (c?.length) setOrganizations(c); }}>
                            <Building2 className="h-4 w-4" /> All Organizations
                          </div>
                          {organizations.map((group) => (
                            <div key={group.base_name}>
                              <div className="px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100 rounded-sm"
                                onClick={() => { handleSelectOrganization(group.organization_ids); setOrgSearch(""); setOpenOrgPopover(false); }}>
                                <div className="flex items-center justify-between w-full">
                                  <div className="flex items-center gap-2"><Building2 className="h-4 w-4" />{group.base_name}</div>
                                  {group.branch_count > 1 && <span className="text-xs text-gray-500">{group.branch_count} branches</span>}
                                </div>
                              </div>
                              {group.branch_count > 1 && group.branches.map((branch) => (
                                <div key={branch.id} className="pl-8 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100 rounded-sm"
                                  onClick={() => { handleSelectOrganization([branch.id]); setOrgSearch(""); setOpenOrgPopover(false); }}>
                                  <div className="flex items-center justify-between w-full">
                                    <span>{branch.branch}</span>
                                    {branch.state && <span className="text-xs text-gray-500">{branch.state}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ACSL agent: assigned partner dropdown */}
            {isAcslAgent && (
              <Select value={acslOrgFilter} onValueChange={setAcslOrgFilter}>
                <SelectTrigger className="bg-white h-9 text-sm w-[180px]"><SelectValue placeholder="All Partners" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Partners</SelectItem>
                  {assignedOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.partner_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* All roles: stove ID search */}
            <Input
              placeholder="Stove ID"
              value={filters.stove_id}
              onChange={(e) => handleFilterChange("stove_id", e.target.value)}
              className="bg-white h-9 text-sm w-[140px]"
            />

            {/* All roles: status filter */}
            <Select value={filters.status || "all"} onValueChange={(v) => handleFilterChange("status", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-white h-9 text-sm w-[140px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="sold">Sold</SelectItem>
              </SelectContent>
            </Select>

            {/* Super admin / partner: state filter */}
            {!isAcslAgent && (
              <Select value={filters.state || "all"} onValueChange={(v) => handleFilterChange("state", v === "all" ? "" : v)}>
                <SelectTrigger className="bg-white h-9 text-sm w-[150px]"><SelectValue placeholder="All States" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {Object.keys(lgaAndStates).sort().map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Super admin: branch filter */}
            {isSuperAdmin && (
              <Input
                placeholder="Branch"
                value={filters.branch}
                onChange={(e) => handleFilterChange("branch", e.target.value)}
                className="bg-white h-9 text-sm w-[130px]"
              />
            )}

            {/* Super admin / partner: date range */}
            {!isAcslAgent && (
              <>
                <Input type="date" value={filters.date_from} onChange={(e) => handleFilterChange("date_from", e.target.value)} className="bg-white h-9 text-sm w-[145px]" />
                <Input type="date" value={filters.date_to} onChange={(e) => handleFilterChange("date_to", e.target.value)} className="bg-white h-9 text-sm w-[145px]" />
              </>
            )}

            {/* Super admin: selected org badge */}
            {isSuperAdmin && selectedOrgIds.length > 0 && (
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-gray-200 text-sm">
                <Building2 className="h-4 w-4 text-gray-600" />
                <span className="font-medium text-gray-900">{getSelectedOrgName()}</span>
                <button onClick={() => { handleSelectOrganization([]); setOrgSearch(""); }} className="ml-1 text-gray-400 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {hasActiveFilters && (
              <Button onClick={handleClearFilters} size="sm" variant="outline" className="h-9">
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="space-y-0">
          <div className="bg-[#f4f7e3] rounded-t-lg px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Per page */}
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-500 font-medium whitespace-nowrap">Per page:</span>
                <Select value={pagination.page_size.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[60px] h-7 bg-white text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Super admin: group-by + sort-by controls */}
              {isSuperAdmin && (
                <>
                  <div className="w-px h-5 bg-gray-300" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-gray-500 font-medium whitespace-nowrap">Group by:</span>
                    <Select value={groupBy} onValueChange={setGroupBy}>
                      <SelectTrigger className="h-7 bg-white text-sm w-[145px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="sales_reference">Sales Reference</SelectItem>
                        <SelectItem value="organization">Organization</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-px h-5 bg-gray-300" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-gray-500 font-medium whitespace-nowrap">Sort by:</span>
                    <Select value={sortBy} onValueChange={handleSortByChange}>
                      <SelectTrigger className="h-7 bg-white text-sm w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="status">Status (Sold)</SelectItem>
                        <SelectItem value="stove_id">Stove ID</SelectItem>
                        <SelectItem value="date_sold">Date Sold</SelectItem>
                        <SelectItem value="organization">Organization</SelectItem>
                        <SelectItem value="sales_reference">Sales Reference</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-7 px-2 bg-white text-sm flex items-center gap-1" onClick={toggleSortDir}>
                      {sortDir === "asc" ? <><ArrowUp className="h-3 w-3" /><span>Asc</span></> : <><ArrowDown className="h-3 w-3" /><span>Desc</span></>}
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-600">Total: <span className="text-[#4a5d0f]">{pagination.total_count}</span></p>
              {/* Super admin / partner: CSV download */}
              {!isAcslAgent && (
                <Button
                  size="sm" variant="outline" className="h-7 px-2 text-sm flex items-center gap-1"
                  onClick={() => {
                    const headers = isSuperAdmin
                      ? ["Stove ID", "Sales Reference", "Status", "Partner Name", "Branch", "State", "Date Sold", "Sold To"]
                      : ["Stove ID", "Sales Reference", "Status", "Date Sold", "Sold To"];
                    const rows = stoveIds.map((s) => {
                      const base = [s.stove_id, s.sales_reference || "", s.status];
                      if (isSuperAdmin) { base.push(s.organization_name || ""); base.push(s.branch || ""); base.push(s.location || ""); }
                      base.push(s.sale_date ? new Date(s.sale_date).toLocaleDateString() : "");
                      base.push(s.sold_to || "");
                      return base;
                    });
                    downloadTableAsCSV(headers, rows, `stove-ids-${new Date().toISOString().slice(0, 10)}.csv`);
                  }}
                  disabled={stoveIds.length === 0}
                >
                  <Download className="h-3 w-3" />Download
                </Button>
              )}
            </div>
          </div>

          <div className="bg-white border-x border-gray-200 overflow-x-auto relative">
            {loading && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#4a5d0f]" />
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow style={{ backgroundColor: "#4a5d0f" }} className="hover:bg-transparent">
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Stove ID</TableHead>
                  {/* Sales Reference: super admin / partner */}
                  {!isAcslAgent && <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Sales Reference</TableHead>}
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Status</TableHead>
                  {/* Partner/Branch/State columns: super admin sees all orgs */}
                  {isSuperAdmin && (
                    <>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Partner Name</TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Branch</TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">State</TableHead>
                    </>
                  )}
                  {/* ACSL agent: partner column (they have multiple assigned partners) */}
                  {isAcslAgent && <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Partner</TableHead>}
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Date Sold</TableHead>
                  <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Sold To</TableHead>
                  <TableHead className="text-center text-white font-semibold text-sm whitespace-nowrap">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={loading ? "opacity-40" : ""}>
                {stoveIds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="text-center py-8 text-gray-500">
                      {loading ? "Loading..." : "No stove IDs found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  (() => {
                    let rowIndex = 0;
                    return displayRows.map((item, i) => {
                      if (item.type === "group-header") {
                        rowIndex = 0;
                        return (
                          <TableRow key={`gh-${i}`} className="bg-[#4a5d0f]/10 border-y border-[#4a5d0f]/20">
                            <TableCell colSpan={colSpan} className="py-1.5 px-4 text-sm font-semibold text-[#4a5d0f]">
                              {groupBy === "sales_reference" ? "Sales Ref: " : "Organization: "}{item.label}
                              <span className="ml-2 text-gray-500 font-normal">({item.count} stove{item.count !== 1 ? "s" : ""})</span>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const stove = item.stove;
                      const idx = rowIndex++;
                      return (
                        <TableRow key={stove.id || stove.stove_id} className={`${idx % 2 === 0 ? "bg-white" : "bg-[#f4f7e3]"} hover:bg-[#eef3c4]`}>
                          <TableCell className="font-mono font-medium text-gray-900 text-sm">{stove.stove_id}</TableCell>
                          {!isAcslAgent && <TableCell className="text-sm">{stove.sales_reference || "—"}</TableCell>}
                          <TableCell>
                            <Badge className={stove.status === "sold"
                              ? "bg-blue-100 text-blue-800 border-blue-200 text-sm"
                              : "bg-green-100 text-green-800 border-green-200 text-sm"}>
                              {stove.status ? stove.status.charAt(0).toUpperCase() + stove.status.slice(1) : "—"}
                            </Badge>
                          </TableCell>
                          {isSuperAdmin && (
                            <>
                              <TableCell className="text-sm text-gray-600">{stove.organization_name || "N/A"}</TableCell>
                              <TableCell className="text-sm text-gray-600">{stove.branch || "N/A"}</TableCell>
                              <TableCell className="text-sm text-gray-600">{stove.location || "N/A"}</TableCell>
                            </>
                          )}
                          {isAcslAgent && <TableCell className="text-sm text-gray-600">{stove.organization_name || "—"}</TableCell>}
                          <TableCell className="text-sm text-gray-600">
                            {stove.status === "sold" ? formatDate(stove.sale_date || stove.date_sold) : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">{stove.sold_to || "—"}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              {stove.status === "sold" && !isAcslAgent && (
                                <Button
                                  size="sm"
                                  onClick={() => handleViewStove(stove)}
                                  disabled={loadingStoveId === stove.id}
                                  className="bg-[#4a5d0f] hover:bg-[#4a5d0f]/90 text-white h-7 px-3 text-sm"
                                >
                                  {loadingStoveId === stove.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                  Details
                                </Button>
                              )}
                              {/* Archive: super admin only */}
                              {isSuperAdmin && !stove.is_archived && stove.status !== "sold" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => { setStoveToArchive(stove); setShowArchiveModal(true); }}
                                  className="h-7 px-3 text-sm border-red-200 text-red-600 hover:bg-red-50"
                                >
                                  Archive
                                </Button>
                              )}
                              {stove.is_archived && (
                                <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-sm">Archived</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()
                )}
              </TableBody>
            </Table>
          </div>

          {pagination.total_pages > 1 && (
            <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">{startRecord}–{endRecord}</span> of <span className="font-medium">{pagination.total_count}</span> records
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => handlePageChange(1)} disabled={pagination.page === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page === 1}><ChevronLeft className="h-4 w-4 mr-1" />Prev</Button>
                {getVisiblePages().map((p) => (
                  <Button key={p} variant={p === pagination.page ? "default" : "outline"} size="sm"
                    className={`h-8 w-8 p-0 ${p === pagination.page ? "bg-[#4a5d0f] text-white hover:bg-[#4a5d0f]" : ""}`}
                    onClick={() => handlePageChange(p)}>{p}</Button>
                ))}
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page === pagination.total_pages}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => handlePageChange(pagination.total_pages)} disabled={pagination.page === pagination.total_pages}><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sale detail modal — super admin / partner only */}
      {!isAcslAgent && (
        <AdminSalesDetailModal
          open={showSaleModal}
          onClose={() => { setShowSaleModal(false); setSelectedSale(null); }}
          sale={selectedSale}
          viewFrom="admin"
        />
      )}

      {/* Archive modal — super admin only */}
      {isSuperAdmin && showArchiveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-red-50">
              <h3 className="font-bold text-red-800 flex items-center gap-2"><Package className="h-5 w-5" /> Archive Stove ID</h3>
              <button onClick={() => { setShowArchiveModal(false); setStoveToArchive(null); setArchiveNote(""); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                <p className="font-semibold">Warning:</p>
                <p>Archiving stove ID <strong>{stoveToArchive?.stove_id}</strong> will make it invisible in regular dashboard views.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Reason for Archiving</label>
                <textarea
                  className="w-full min-h-[100px] p-3 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Enter the reason for archiving this stove ID..."
                  value={archiveNote}
                  onChange={(e) => setArchiveNote(e.target.value)}
                />
              </div>
            </div>
            <div className="p-4 bg-gray-50 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowArchiveModal(false); setStoveToArchive(null); setArchiveNote(""); }} disabled={archiving}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleArchiveStove} disabled={archiving || !archiveNote.trim()}>
                {archiving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Archive Stove
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </DashboardLayout>
  );
}

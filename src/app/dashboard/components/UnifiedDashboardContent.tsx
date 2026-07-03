
import { supabaseFunctionsUrl } from "@/lib/supabaseConfig";
import { useState, useEffect, useCallback, useMemo } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import DashboardContentBase from "./DashboardContent";
import PartnerDashboardTableSection from "./PartnerDashboardTableSection";
import SalesFormModal from "../../admin/components/sales/SalesFormModal";
import { useAuth } from "../../contexts/useAuth";
import { usePermissions } from "../../hooks/usePermissions";
import superAdminDashboardService from "../../services/superAdminDashboardService";
import superAdminAgentService from "../../services/superAdminAgentService";
import adminDashboardService from "../../services/adminDashboardService";
import salesAdvancedService from "../../services/salesAdvancedAPIService";

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Aggregate raw sales rows into 12 monthly buckets keyed by short month name.
function bucketMonthlySales(rows: any[]): { month: string; value: number }[] {
  const counts = new Array(12).fill(0);
  (rows || []).forEach((r: any) => {
    const raw = r?.sales_date || r?.sale_date || r?.created_at;
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return;
    const qty = Number(r?.quantity ?? 1) || 1;
    counts[d.getMonth()] += qty;
  });
  return MONTH_LABELS.map((m, i) => ({ month: m, value: counts[i] }));
}

const DashboardContent = DashboardContentBase as any;





const CURRENT_YEAR = new Date().getFullYear();
const ALL_YEARS = Array.from({ length: CURRENT_YEAR - 2023 }, (_, i) => 2024 + i);

type Scope = "global" | "acsl_agent" | "partner" | "partner_agent";

/**
 * Single dashboard view shared across every role.
 * Role-specific data sources and filters are selected here; the underlying
 * <DashboardContent /> remains the one render surface and uses RoleGate /
 * the `role` prop for access-controlled UI bits.
 */
const UnifiedDashboardContent = () => {
  const { user, userRole, getOrganizationId, supabase } = useAuth() as any;
  const { can } = usePermissions();

  // Decide scope from permissions (super_admin gets global automatically).
  const scope: Scope = useMemo(() => {
    if (can("global-filters")) return "global";
    if (can("my-partners-filter")) return "acsl_agent";
    if (userRole === "partner_agent" || userRole === "agent") return "partner_agent";
    return "partner";
  }, [can, userRole]);

  // Shared state
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [years, setYears] = useState<number[]>([CURRENT_YEAR]); // global only
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Global-scope filters
  const [filters, setFilters] = useState<any>({
    selectedGroup: null, state: null, branch: null, dateFrom: null, dateTo: null,
  });
  const [groupedPartners, setGroupedPartners] = useState<any[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);

  // ACSL-agent scope: partners list assigned to this agent
  const [partners, setPartners] = useState<any[]>([]);

  // Fetch ACSL-agent partner list
  useEffect(() => {
    if (scope !== "acsl_agent" || !user?.id) return;
    superAdminAgentService.getAgentOrganizations(user.id)
      .then((r: any) => { if (r.success) setPartners(r.data || []); })
      .catch((err: any) => console.error("Error fetching agent partners:", err));
  }, [scope, user?.id]);

  // Fetch global-scope grouped partners
  const fetchGroupedPartners = useCallback(async (search = "") => {
    if (scope !== "global") return;
    setLoadingPartners(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({ page_size: "200" });
      if (search) params.set("search", search);
      const res = await fetch(
        `${supabaseFunctionsUrl}/get-organizations-grouped?${params}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const result = await res.json();
      setGroupedPartners(result.data || []);
    } catch (err) {
      console.error("Failed to fetch grouped partners:", err);
    } finally {
      setLoadingPartners(false);
    }
  }, [scope, supabase]);

  useEffect(() => { fetchGroupedPartners(); }, [fetchGroupedPartners]);

  const availableBranches = useMemo(() => {
    if (!filters.selectedGroup) return [];
    const branches = filters.selectedGroup.branches || [];
    const filtered = filters.state
      ? branches.filter((b: any) => b.state?.toLowerCase() === filters.state.toLowerCase())
      : branches;
    return [...new Set(filtered.map((b: any) => b.branch).filter(Boolean))].sort();
  }, [filters]);

  // If a single month is picked (and there is no custom date range), translate it
  // into a yyyy-mm-01 / yyyy-mm-last date window so every downstream query
  // (stats edge fn + sales fetch) actually narrows by month.
  const monthRange = useMemo(() => {
    const months: number[] = Array.isArray(filters.months) ? filters.months : [];
    if (months.length !== 1) return null;
    if (filters.dateFrom || filters.dateTo) return null;
    const m = months[0];
    const y = scope === "global"
      ? (years.length === 1 ? years[0] : new Date().getFullYear())
      : year;
    const mm = String(m).padStart(2, "0");
    const last = new Date(y, m, 0).getDate();
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }, [filters.months, filters.dateFrom, filters.dateTo, years, year, scope]);

  // Build the sales-fetch filter that mirrors the active dashboard period filter
  const buildSalesFilters = useCallback(() => {
    const salesFilters: any = {
      page: 1,
      limit: 5000,
      sortBy: "sales_date",
      sortOrder: "desc",
      includeAddress: false,
      includeCreator: false,
      includeImages: false,
      responseFormat: "format2",
    };

    if (scope === "global") {
      if (filters.dateFrom) salesFilters.dateFrom = filters.dateFrom;
      if (filters.dateTo) salesFilters.dateTo = filters.dateTo;
      if (!filters.dateFrom && !filters.dateTo) {
        if (monthRange) {
          salesFilters.dateFrom = monthRange.from;
          salesFilters.dateTo = monthRange.to;
        } else {
          const ys = years.length ? years : ALL_YEARS;
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          salesFilters.dateFrom = `${minY}-01-01`;
          salesFilters.dateTo = `${maxY}-12-31`;
        }
      }
      if (filters.state) salesFilters.state = filters.state;
      if (filters.branch) salesFilters.branch = filters.branch;
      if (filters.selectedGroup?.organization_ids?.length) {
        const allBranches = filters.selectedGroup.branches || [];
        let orgIds = filters.selectedGroup.organization_ids;
        if (filters.state) {
          const stateIds = allBranches
            .filter((b: any) => b.state?.toLowerCase() === filters.state.toLowerCase())
            .map((b: any) => b.id);
          if (stateIds.length) orgIds = stateIds;
        }
        if (filters.branch) {
          const branchIds = allBranches.filter((b: any) => b.branch === filters.branch).map((b: any) => b.id);
          if (branchIds.length) orgIds = branchIds;
        }
        salesFilters.organization_ids = orgIds;
      }
    } else {
      if (dateFrom) salesFilters.dateFrom = dateFrom;
      if (dateTo) salesFilters.dateTo = dateTo;
      if (!dateFrom && !dateTo) {
        if (monthRange) {
          salesFilters.dateFrom = monthRange.from;
          salesFilters.dateTo = monthRange.to;
        } else {
          salesFilters.dateFrom = `${year}-01-01`;
          salesFilters.dateTo = `${year}-12-31`;
        }
      }
      const orgId = getOrganizationId?.();
      if (orgId) salesFilters.organization_id = orgId;
    }

    return salesFilters;
  }, [scope, year, years, dateFrom, dateTo, filters, monthRange, getOrganizationId]);

  // Fetch dashboard stats based on scope (plus monthly sales aggregation)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const statsPromise: Promise<any> = (() => {
        if (scope === "global") {
          const selectedYears = years.length ? years : ALL_YEARS;
          const payload: any = { years: selectedYears };
          if (filters.selectedGroup?.organization_ids?.length) {
            const allBranches = filters.selectedGroup.branches || [];
            let orgIds = filters.selectedGroup.organization_ids;
            if (filters.state) {
              const stateIds = allBranches
                .filter((b: any) => b.state?.toLowerCase() === filters.state.toLowerCase())
                .map((b: any) => b.id);
              if (stateIds.length) orgIds = stateIds;
            }
            if (filters.branch) {
              const branchIds = allBranches.filter((b: any) => b.branch === filters.branch).map((b: any) => b.id);
              if (branchIds.length) orgIds = branchIds;
            }
            payload.organization_ids = orgIds;
          }
          if (filters.state) payload.state = filters.state;
          if (filters.branch) payload.branch = filters.branch;
          if (filters.dateFrom) payload.date_from = filters.dateFrom;
          if (filters.dateTo) payload.date_to = filters.dateTo;
          if (!filters.dateFrom && !filters.dateTo && monthRange) {
            payload.date_from = monthRange.from;
            payload.date_to = monthRange.to;
          }
          if (Array.isArray(filters.months) && filters.months.length) {
            payload.months = filters.months;
          }
          return superAdminDashboardService.getDashboardStats(payload);
        } else if (scope === "acsl_agent" || scope === "partner_agent") {
          return superAdminAgentService.getDashboardStats({
            year: (!dateFrom && !dateTo && !monthRange) ? year : undefined,
            date_from: dateFrom || monthRange?.from || undefined,
            date_to: dateTo || monthRange?.to || undefined,
          });
        }
        return adminDashboardService.getDashboardStats({
          year: (!dateFrom && !dateTo && !monthRange) ? year : undefined,
          date_from: dateFrom || monthRange?.from || undefined,
          date_to: dateTo || monthRange?.to || undefined,
        });
      })();

      const salesPromise = salesAdvancedService
        .getSalesData(buildSalesFilters(), "POST", "DashboardMonthlySales")
        .catch((err: any) => {
          console.error("Monthly sales fetch failed:", err);
          return null;
        });

      const [response, salesResp] = await Promise.all([statsPromise, salesPromise]);

      const monthlySales = bucketMonthlySales(
        Array.isArray(salesResp?.data) ? salesResp.data : (salesResp?.data?.sales ?? [])
      );

      if (response?.success) {
        setData({ ...(response.data || {}), monthlySales });
      } else {
        console.error("Dashboard fetch failed:", response?.error || response?.message);
        setData((prev: any) => ({ ...(prev || {}), monthlySales }));
      }
    } catch (err) {
      console.error("Dashboard error:", err);
    } finally {
      setLoading(false);
    }
  }, [scope, year, years, dateFrom, dateTo, filters, monthRange, buildSalesFilters]);



  useEffect(() => { fetchData(); }, [fetchData]);

  // Clear month filter if it becomes invalid (future month) after a year change.
  useEffect(() => {
    const months: number[] = Array.isArray(filters.months) ? filters.months : [];
    if (!months.length) return;
    const now = new Date();
    const currentYearNum = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const effectiveYear = scope === "global"
      ? (years.length === 1 ? years[0] : currentYearNum)
      : year;
    const valid = months.filter((m) => {
      if (effectiveYear > currentYearNum) return false;
      if (effectiveYear === currentYearNum && m > currentMonthNum) return false;
      return true;
    });
    if (valid.length !== months.length) {
      setFilters((prev: any) => ({ ...prev, months: valid }));
    }
  }, [year, years, scope, filters.months]);

  // Normalize stats across services
  const normalized = useMemo(() => {
    if (!data) return null;
    if (scope === "global") {
      return {
        stovesReceived: data.stovesReceivedByPartners ?? 0,
        stovesSold: data.stovesSoldToEndUsers ?? 0,
        availableStoves: data.availableStoves ?? 0,
        expectedReceivable: data.expectedReceivable ?? 0,
        amountReceived: data.amountReceived ?? 0,
        outstandingBalance: data.outstandingBalance ?? 0,
        byState: (data.salesByState ?? []).map((s: any) => ({ state: s.state, count: s.sales ?? s.count ?? 0 })),
        salesModelData: data.salesModelData ?? [],
        topPartners: data.topPartners ?? [],
        topAgents: data.topAgents ?? [],
        monthlySales: data.monthlySales ?? [],
      };
    }
    if (scope === "partner") {
      return {
        stovesReceived: data.totalStovesReceived ?? 0,
        stovesSold: data.totalStovesSold ?? 0,
        availableStoves: data.totalStovesAvailable ?? 0,
        expectedReceivable: data.totalExpectedAmount ?? 0,
        amountReceived: data.totalAmountPaid ?? 0,
        outstandingBalance: data.totalAmountOwed ?? 0,
        byState: data.byState ?? [],
        salesModelData: data.salesModelData ?? [],
        monthlySales: data.monthlySales ?? [],
      };
    }
    // acsl_agent + partner_agent
    return {
      stovesReceived: data.stovesReceived ?? 0,
      stovesSold: data.stovesSold ?? 0,
      availableStoves: data.availableStoves ?? 0,
      expectedReceivable: data.expectedReceivable ?? 0,
      amountReceived: data.amountReceived ?? 0,
      outstandingBalance: data.outstandingBalance ?? 0,
      byState: data.byState ?? [],
      salesModelData: data.salesModelData ?? [],
      monthlySales: data.monthlySales ?? [],
      teamSalesCount: data.teamSalesCount ?? null,
    };

  }, [data, scope]);

  const handleFilterChange = (field: string, value: any) => {
    setFilters((prev: any) => {
      const next = { ...prev, [field]: value };
      if (field === "selectedGroup") { next.state = null; next.branch = null; }
      if (field === "state") next.branch = null;
      return next;
    });
  };

  const handleClearFilters = () => {
    setFilters({ selectedGroup: null, state: null, branch: null, dateFrom: null, dateTo: null, months: [] } as any);
    setYear(CURRENT_YEAR);
    setYears([CURRENT_YEAR]);
  };

  const handleCardClick = (cardKey: string) => setActiveCard((p) => (p === cardKey ? null : cardKey));

  // Role label passed to DashboardContent (preserve existing UI conditionals)
  const renderRole =
    scope === "global" ? "super_admin"
    : scope === "acsl_agent" ? (userRole === "acsl_agent_manager" ? "acsl_agent_manager" : "acsl_agent")
    : scope === "partner_agent" ? "partner_agent"
    : "partner";

  const showDrilldown = scope === "acsl_agent" || scope === "partner";

  return (
    <DashboardLayout currentRoute="dashboard">
      <div className="flex-1 overflow-y-auto bg-white">
        <DashboardContent
          data={normalized}
          loading={loading}
          role={renderRole}
          // Global-scope props
          years={years}
          onYearsChange={setYears}
          dashboardFilters={filters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          partnersList={groupedPartners}
          loadingPartners={loadingPartners}
          onPartnerSearch={fetchGroupedPartners}
          availableBranches={availableBranches}
          // Other scopes
          year={year}
          onYearChange={setYear}
          partners={partners}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          activeCard={activeCard}
          onCardClick={handleCardClick}
        />

        {showDrilldown && activeCard && (
          <div className="px-8 pb-8">
            <PartnerDashboardTableSection
              key={`${activeCard}-${year}-${dateFrom}-${dateTo}-${reloadKey}`}
              activeCard={activeCard}
              organizationId={getOrganizationId()}
              year={year}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onClose={() => setActiveCard(null)}
              onCreateSale={() => setShowCreateModal(true)}
              onDeleteSale={async (sale: any) => {
                if (window.confirm(`Delete sale for ${sale.end_user_name}?`)) {
                  const { default: adminSalesService } = await import("../../services/adminSalesService");
                  const result = await adminSalesService.deleteSale(sale.id);
                  if (result.success) setReloadKey((k) => k + 1);
                  else alert(result.error || "Failed to delete sale");
                }
              }}
            />
          </div>
        )}

        {showCreateModal && (
          <SalesFormModal
            open={true}
            onOpenChange={setShowCreateModal}
            mode="create"
            onSuccess={() => {
              setShowCreateModal(false);
              setReloadKey((k) => k + 1);
              fetchData();
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
};

export default UnifiedDashboardContent;


import { useState, useEffect, useMemo, useCallback } from "react";
import FinancialSummaryCards from "./FinancialSummaryCards";
import PaymentStatusCards from "./PaymentStatusCards";
import FinancialReportsFilters from "./FinancialReportsFilters";
import FinancialReportsTable from "./FinancialReportsTable";
import PaymentHistoryModal from "./PaymentHistoryModal";
import RecordPaymentModal from "../sales/RecordPaymentModal";
import AdminSalesDetailModal from "../sales/AdminSalesDetailModal";
import { AdminSales } from "@/types/adminSales";
import adminSalesService from "../../../services/adminSalesService";
import { Loader2, Eye, EyeOff, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lgaAndStates } from "../../../constants";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";

// --- YearFilterBar helper ---
const STORAGE_KEY = "super_admin_manage_sales_selected_years";

const loadSelectedYears = (): number[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as number[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [new Date().getFullYear()];
};

const saveSelectedYears = (years: number[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(years)); } catch {}
};

const getYearPillLabel = (selected: number[], available: number[]): string => {
  if (selected.length === 0 || selected.length === available.length) return "All Years";
  return [...selected].sort((a, b) => a - b).join(", ");
};

interface YearFilterBarProps {
  selectedYears: number[];
  availableYears: number[];
  onChange: (years: number[]) => void;
}

const YearFilterBar: React.FC<YearFilterBarProps> = ({ selectedYears, availableYears, onChange }) => {
  const [open, setOpen] = useState(false);
  const handleToggle = (year: number) => {
    const updated = selectedYears.includes(year)
      ? selectedYears.filter((y) => y !== year)
      : [...selectedYears, year].sort((a, b) => a - b);
    if (updated.length === 0) return;
    onChange(updated);
    saveSelectedYears(updated);
  };
  const pillLabel = getYearPillLabel(selectedYears, availableYears);
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          <span>Active year(s) in view</span>
          <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-medium">{pillLabel}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border">
          <div className="flex flex-wrap items-center gap-4 mt-2">
            {availableYears.map((year) => (
              <label key={year} className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={selectedYears.includes(year)} onCheckedChange={() => handleToggle(year)} />
                <span className="text-sm font-medium text-foreground">{year}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface FinancialReportsViewProps {
  loadSales: () => Promise<{ success: boolean; data?: AdminSales[]; error?: string }>;
  onEditSale?: (sale: AdminSales) => void;
  onDeleteSale?: (sale: AdminSales) => void;
  onCancelSale?: (sale: AdminSales) => void;
  onApproveSale?: (sale: AdminSales) => void;
  viewFrom?: "admin" | "superAdmin" | "agent" | "acsl_agent";
  selectedYear?: number;
  onYearChange?: (year: number) => void;
  availableYears?: number[];
  onExportReady?: (fn: () => void) => void;
  onSelectionChange?: (count: number) => void;
  initialSearchTerm?: string;
  initialPaymentStatus?: string;
}

const getAmountPaid = (sale: AdminSales): number =>
  sale.total_paid ?? (sale.is_installment ? 0 : (sale.amount ?? 0));

const getAmountOwed = (sale: AdminSales): number =>
  Math.max(0, (sale.amount ?? 0) - getAmountPaid(sale));

const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({ loadSales, onEditSale, onDeleteSale, onCancelSale, onApproveSale, viewFrom = "admin", selectedYear: externalSelectedYear, onYearChange: externalOnYearChange, availableYears: externalAvailableYears, onExportReady, onSelectionChange, initialSearchTerm, initialPaymentStatus }) => {
  const [allSales, setAllSales] = useState<AdminSales[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState(initialSearchTerm ?? "");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState(initialPaymentStatus ?? "all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [showFinancialSummary, setShowFinancialSummary] = useState(true);
  const [showStatusBreakdown, setShowStatusBreakdown] = useState(true);

  const [detailModalSale, setDetailModalSale] = useState<AdminSales | null>(null);
  const [historyModalSale, setHistoryModalSale] = useState<AdminSales | null>(null);
  const [paymentModalSale, setPaymentModalSale] = useState<AdminSales | null>(null);

  // New filters
  const [selectedState, setSelectedState] = useState("all");
  const [selectedLGA, setSelectedLGA] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [internalSelectedYears, setInternalSelectedYears] = useState<number[]>(loadSelectedYears);
  const selectedYears = useMemo(
    () => externalSelectedYear !== undefined ? [externalSelectedYear] : internalSelectedYears,
    [externalSelectedYear, internalSelectedYears]
  );
  const setSelectedYears = (years: number[]) => {
    setInternalSelectedYears(years);
    saveSelectedYears(years);
  };
  const [exporting, setExporting] = useState(false);

  const stateList = useMemo(() => Object.keys(lgaAndStates).sort(), []);
  const lgaList = useMemo(
    () => selectedState !== "all" ? (lgaAndStates as Record<string, string[]>)[selectedState] || [] : [],
    [selectedState]
  );

  const availableYears = useMemo(() => {
    if (externalAvailableYears) return externalAvailableYears;
    if (allSales.length === 0) return [new Date().getFullYear()];
    const years = Array.from(
      new Set(
        allSales
          .map((s) => { const d = s.sales_date || s.created_at; return d ? new Date(d).getFullYear() : null; })
          .filter((y): y is number => y !== null)
      )
    ).sort((a, b) => a - b);
    return years.length > 0 ? years : [new Date().getFullYear()];
  }, [allSales, externalAvailableYears]);

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await loadSales();
      if (result.success) {
        setAllSales(result.data || []);
      } else {
        setError(result.error || "Failed to fetch data");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [loadSales]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const filteredSales = useMemo(() => {
    let result = [...allSales];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((s) =>
        (s.end_user_name || "").toLowerCase().includes(term) ||
        (s.transaction_id || "").toLowerCase().includes(term) ||
        (s.phone || "").toLowerCase().includes(term) ||
        (s.partner_name || "").toLowerCase().includes(term) ||
        (s.stove_serial_no || "").toLowerCase().includes(term)
      );
    }

    if (viewFrom === "superAdmin") {
      if (externalSelectedYear !== undefined) {
        result = result.filter((s) => {
          const d = s.sales_date || s.created_at;
          if (!d) return true; // no date — don't exclude
          return new Date(d).getFullYear() === externalSelectedYear;
        });
      } else if (selectedYears.length > 0 && selectedYears.length < availableYears.length) {
        result = result.filter((s) => {
          const d = s.sales_date || s.created_at;
          if (!d) return true;
          return selectedYears.includes(new Date(d).getFullYear());
        });
      }
    }

    if (paymentStatusFilter !== "all") {
      result = result.filter((s) => {
        const paid = getAmountPaid(s);
        switch (paymentStatusFilter) {
          case "paid":    return !s.is_installment || s.payment_status === "fully_paid";
          case "partial": return s.is_installment && s.payment_status === "partially_paid";
          case "unpaid":  return s.is_installment && paid === 0;
          default:        return true;
        }
      });
    }

    if (selectedState !== "all") {
      result = result.filter((s) => (s.state_backup || "").toLowerCase() === selectedState.toLowerCase());
    }
    if (selectedLGA !== "all") {
      result = result.filter((s) => (s.lga_backup || "").toLowerCase() === selectedLGA.toLowerCase());
    }
    if (orgFilter !== "all") {
      result = result.filter((s) => (s.organization_id === orgFilter || s.partner_id === orgFilter));
    }
    if (approvalFilter !== "all") {
      result = result.filter((s) => approvalFilter === "approved" ? s.agent_approved : !s.agent_approved);
    }

    if (startDate) result = result.filter((s) => (s.sales_date || s.created_at) >= startDate);
    if (endDate)   result = result.filter((s) => (s.sales_date || s.created_at) <= endDate + "T23:59:59");

    result.sort((a, b) => {
      const dA = new Date(a.sales_date || a.created_at).getTime();
      const dB = new Date(b.sales_date || b.created_at).getTime();
      return sortOrder === "asc" ? dA - dB : dB - dA;
    });

    return result;
  }, [allSales, searchTerm, paymentStatusFilter, startDate, endDate, sortOrder, selectedState, selectedLGA, orgFilter, approvalFilter, selectedYears, availableYears, viewFrom]);

  const financialSummary = useMemo(() => {
    const totalReceivable = filteredSales.reduce((sum, s) => sum + (s.amount || 0), 0);
    const totalCollected  = filteredSales.reduce((sum, s) => sum + getAmountPaid(s), 0);
    const outstandingBalance = totalReceivable - totalCollected;
    return {
      totalReceivable, totalCollected, outstandingBalance,
      salesCount: filteredSales.length,
      collectedPercent:    totalReceivable > 0 ? (totalCollected / totalReceivable) * 100 : 0,
      outstandingPercent:  totalReceivable > 0 ? (outstandingBalance / totalReceivable) * 100 : 0,
    };
  }, [filteredSales]);

  const paymentBreakdown = useMemo(() => ({
    totalOrders:    filteredSales.length,
    fullyPaid:      filteredSales.filter((s) => !s.is_installment || s.payment_status === "fully_paid").length,
    partiallyPaid:  filteredSales.filter((s) => s.is_installment && s.payment_status === "partially_paid").length,
    unpaid:         filteredSales.filter((s) => s.is_installment && (s.total_paid ?? 0) === 0).length,
  }), [filteredSales]);

  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, paymentStatusFilter, startDate, endDate, pageSize, selectedState, selectedLGA, orgFilter, approvalFilter, selectedYears]);

  const hasActiveFilters = searchTerm !== "" || paymentStatusFilter !== "all" || startDate !== "" || endDate !== "" || selectedState !== "all" || selectedLGA !== "all" || orgFilter !== "all" || approvalFilter !== "all";

  const clearFilters = () => {
    setSearchTerm(""); setPaymentStatusFilter("all"); setStartDate(""); setEndDate("");
    setSelectedState("all"); setSelectedLGA("all"); setOrgFilter("all"); setApprovalFilter("all");
  };

  // Clicking a status card toggles the filter
  const handleCardFilterClick = (filter: string) => {
    setPaymentStatusFilter((prev) => prev === filter ? "all" : filter);
  };

  useEffect(() => {
    if (onExportReady) onExportReady(handleExport);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales]);

  const handlePaymentSuccess = () => { setPaymentModalSale(null); fetchSales(); };

  const toggleBtn = (show: boolean, onToggle: () => void) => (
    <Button variant="ghost" size="sm"
      className="h-7 w-fit p-0 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      onClick={onToggle}
    >
      {show
        ? <><p>Hide</p><EyeOff className="h-4 w-4" /></>
        : <><p>Show</p><Eye className="h-4 w-4" /></>}
    </Button>
  );

  const handleExport = async () => {
    try {
      setExporting(true);

      const result = await (adminSalesService as any).getSalesForExport({
        search: searchTerm || undefined,
        paymentStatus: paymentStatusFilter !== "all" ? paymentStatusFilter : undefined,
        dateFrom: startDate || undefined,
        dateTo: endDate || undefined,
        state: selectedState !== "all" ? selectedState : undefined,
        lga: selectedLGA !== "all" ? selectedLGA : undefined,
        organizationId: orgFilter !== "all" ? orgFilter : undefined,
      });

      if (!result.success || !result.data?.length) {
        alert("No data to export.");
        return;
      }

      let exportData = result.data;
      if (approvalFilter !== "all") {
        exportData = exportData.filter((s: any) =>
          approvalFilter === "approved" ? s.agent_approved : !s.agent_approved
        );
      }
      if (selectedYears.length > 0 && selectedYears.length < availableYears.length) {
        exportData = exportData.filter((s: any) => {
          const d = s.sales_date || s.created_at;
          return d && selectedYears.includes(new Date(d).getFullYear());
        });
      }

      const { exportSalesDataToCSV } = await import("@/utils/csvExportUtils");
      exportSalesDataToCSV(exportData, `sales-export-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading sales data...</span>
        </div>
      ) : (
        <>
          {/* Filters */}
          <FinancialReportsFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            paymentStatusFilter={paymentStatusFilter}
            onPaymentStatusChange={setPaymentStatusFilter}
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
            onClearFilters={clearFilters}
            hasActiveFilters={hasActiveFilters}
            // Role specific filters
            selectedState={viewFrom === "superAdmin" ? selectedState : undefined}
            onStateChange={viewFrom === "superAdmin" ? (val) => { setSelectedState(val); setSelectedLGA("all"); } : undefined}
            selectedLGA={viewFrom === "superAdmin" ? selectedLGA : undefined}
            onLGAChange={viewFrom === "superAdmin" ? setSelectedLGA : undefined}
            stateList={stateList}
            lgaList={lgaList}
            orgFilter={viewFrom === "acsl_agent" ? orgFilter : undefined}
            onOrgChange={viewFrom === "acsl_agent" ? setOrgFilter : undefined}
            approvalFilter={viewFrom === "acsl_agent" ? approvalFilter : undefined}
            onApprovalChange={viewFrom === "acsl_agent" ? setApprovalFilter : undefined}
            // We would need to fetch assignedOrgs if viewFrom === "acsl_agent"
            // For now, we can extract them from allSales
            assignedOrgs={viewFrom === "acsl_agent" ? Array.from(new Set(allSales.map(s => s.organization_id).filter(Boolean))).map(id => ({
              id: id as string,
              partner_name: allSales.find(s => s.organization_id === id)?.partner_name || "Unknown Partner"
            })) : []}
          />


          {/* Table */}
          <FinancialReportsTable
            data={paginatedSales}
            loading={false}
            currentPage={currentPage}
            pageSize={pageSize}
            totalRecords={filteredSales.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            onViewDetails={setDetailModalSale}
            onViewHistory={setHistoryModalSale}
            onRecordPayment={setPaymentModalSale}
            onApproveSale={onApproveSale}
            onEditSale={onEditSale}
            onDeleteSale={onDeleteSale}
            onCancelSale={onCancelSale}
            sortOrder={sortOrder}
            onToggleSort={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
            viewFrom={viewFrom === "acsl_agent" ? "agent" : viewFrom}
          />
        </>
      )}

      {/* Modals */}
      <AdminSalesDetailModal
        open={!!detailModalSale}
        onClose={() => setDetailModalSale(null)}
        sale={detailModalSale}
        viewFrom={viewFrom === "superAdmin" ? "superAdmin" : "admin"}
        onSaleUpdated={fetchSales}
      />

      <PaymentHistoryModal open={!!historyModalSale} onClose={() => setHistoryModalSale(null)} sale={historyModalSale} />

      {paymentModalSale && (
        <RecordPaymentModal
          saleId={paymentModalSale.id}
          remainingBalance={getAmountOwed(paymentModalSale)}
          onClose={() => setPaymentModalSale(null)}
          onSuccess={handlePaymentSuccess}
          saleSummary={{
            transactionId: paymentModalSale.transaction_id,
            customerName: paymentModalSale.end_user_name,
            totalAmount: paymentModalSale.amount,
            amountPaid: getAmountPaid(paymentModalSale),
            amountOwed: getAmountOwed(paymentModalSale),
          }}
        />
      )}
    </div>
  );
};

export default FinancialReportsView;

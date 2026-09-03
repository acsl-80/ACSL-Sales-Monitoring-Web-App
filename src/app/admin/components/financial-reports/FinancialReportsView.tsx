import { useState, useEffect, useMemo } from "react";
import FinancialSummaryCards from "./FinancialSummaryCards";
import FinancialReportsFilters from "./FinancialReportsFilters";
import FinancialReportsTable from "./FinancialReportsTable";
import SalesTrackingBar, { TrackingKey } from "./SalesTrackingBar";
import PaymentHistoryModal from "./PaymentHistoryModal";
import RecordPaymentModal from "../sales/RecordPaymentModal";
import AdminSalesDetailModal from "../sales/AdminSalesDetailModal";
import { useToastNotification } from "@/app/contexts/useToastNotification";
import { AdminSales } from "@/types/adminSales";
import adminSalesService from "../../../services/adminSalesService";
import { Loader2 } from "lucide-react";
import { lgaAndStates } from "../../../constants";
import paymentModelService from "../../../services/paymentModelService";
import { DEFAULT_PAGE_SIZE, useSalesReport } from "./useSalesReport";
import { toFinancialSummary, toTrackingCounts } from "./salesReportSummary";

/*
 * Sales Records and the Financial Report.
 *
 * Slice 9a of the 2026-09-02 review (finding F6). This view used to load at
 * most 500 sales and do everything in the browser: search, every filter, the
 * sort, the paging, the money totals, the status counts and the due chips.
 * Past five hundred sales each of those was computed over the first five
 * hundred and shown as the whole. The server now pages, filters, sorts and
 * totals; the screen's state becomes a request in useSalesReport, the
 * server's summary becomes the cards and the chips in salesReportSummary, and
 * what is left here is the screen.
 */

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(years));
  } catch {}
};

interface FinancialReportsViewProps {
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
  /** A host page's period, as the partner dashboard's drill-down passes it. */
  initialStartDate?: string;
  initialEndDate?: string;
  /** Bumped by the host page after a create or a delete, to fetch again. */
  reloadKey?: number;
}

// See FinancialReportsTable: total_paid is the real collected figure.
const getAmountPaid = (sale: AdminSales): number => sale.total_paid ?? 0;

const getAmountOwed = (sale: AdminSales): number =>
  Math.max(0, (sale.amount ?? 0) - getAmountPaid(sale));

const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({
  onEditSale,
  onDeleteSale,
  onCancelSale,
  onApproveSale,
  viewFrom = "admin",
  selectedYear: externalSelectedYear,
  availableYears: externalAvailableYears,
  onExportReady,
  initialSearchTerm,
  initialPaymentStatus,
  initialStartDate,
  initialEndDate,
  reloadKey = 0,
}) => {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm ?? "");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState(initialPaymentStatus ?? "all");
  const [startDate, setStartDate] = useState(initialStartDate ?? "");
  const [endDate, setEndDate] = useState(initialEndDate ?? "");

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [detailModalSale, setDetailModalSale] = useState<AdminSales | null>(null);
  const [historyModalSale, setHistoryModalSale] = useState<AdminSales | null>(null);
  const [paymentModalSale, setPaymentModalSale] = useState<AdminSales | null>(null);

  const [selectedState, setSelectedState] = useState("all");
  const [selectedLGA, setSelectedLGA] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [salesModelFilter, setSalesModelFilter] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all"); // "all" | "0".."11"
  const [yearFilter, setYearFilter] = useState<string>("all"); // "all" | "2024" ...
  const [salesModels, setSalesModels] = useState<{ id: string; name: string }[]>([]);
  const [trackingFilter, setTrackingFilter] = useState<TrackingKey>("none");
  const [internalSelectedYears, setInternalSelectedYears] = useState<number[]>(loadSelectedYears);
  const selectedYears = useMemo(
    () => (externalSelectedYear !== undefined ? [externalSelectedYear] : internalSelectedYears),
    [externalSelectedYear, internalSelectedYears],
  );
  const [exporting, setExporting] = useState(false);
  const { toast } = useToastNotification();

  const stateList = useMemo(() => Object.keys(lgaAndStates).sort(), []);
  const lgaList = useMemo(
    () => (selectedState !== "all" ? (lgaAndStates as Record<string, string[]>)[selectedState] || [] : []),
    [selectedState],
  );

  // One request per page, with every filter the server understands. The
  // years the scope covers and the partners it holds come back with it.
  const report = useSalesReport(
    {
      search: searchTerm,
      paymentStatus: paymentStatusFilter,
      startDate,
      endDate,
      state: viewFrom === "superAdmin" ? selectedState : "all",
      lga: viewFrom === "superAdmin" ? selectedLGA : "all",
      organizationId: viewFrom === "acsl_agent" ? orgFilter : "all",
      approval: viewFrom === "acsl_agent" ? approvalFilter : "all",
      salesModelId: salesModelFilter,
      month: selectedMonth,
      yearFilter,
      // The year pills narrow only the super admin's view, as they always have.
      selectedYears: viewFrom === "superAdmin" ? selectedYears : [],
      availableYears: externalAvailableYears ?? [],
      tracking: trackingFilter,
      sortOrder,
      page: currentPage,
      pageSize,
    },
    reloadKey,
  );

  const availableYears = useMemo(() => {
    if (externalAvailableYears) return externalAvailableYears;
    return report.summary.years.length ? report.summary.years : [new Date().getFullYear()];
  }, [externalAvailableYears, report.summary.years]);

  const financialSummary = useMemo(() => toFinancialSummary(report.summary), [report.summary]);
  const trackingCounts = useMemo(() => toTrackingCounts(report.summary), [report.summary]);
  const assignedOrgs = report.summary.partners;

  // Load active sales models for the filter dropdown
  useEffect(() => {
    let mounted = true;
    paymentModelService
      .getPaymentModels({ status: "active" })
      .then((res) => {
        if (!mounted) return;
        const models = (res?.data || [])
          .filter((m: any) => m && m.is_active !== false)
          .map((m: any) => ({ id: m.id, name: m.name }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        setSalesModels(models);
      })
      .catch((err) => console.error("[SalesRecords] failed to load sales models:", err));
    return () => {
      mounted = false;
    };
  }, []);

  // Any change of filter starts the paging over.
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    paymentStatusFilter,
    startDate,
    endDate,
    pageSize,
    selectedState,
    selectedLGA,
    orgFilter,
    approvalFilter,
    salesModelFilter,
    selectedMonth,
    yearFilter,
    selectedYears,
    trackingFilter,
  ]);

  const hasActiveFilters =
    searchTerm !== "" ||
    paymentStatusFilter !== "all" ||
    startDate !== "" ||
    endDate !== "" ||
    selectedState !== "all" ||
    selectedLGA !== "all" ||
    orgFilter !== "all" ||
    approvalFilter !== "all" ||
    salesModelFilter !== "all" ||
    selectedMonth !== "all" ||
    yearFilter !== "all" ||
    trackingFilter !== "none";

  const clearFilters = () => {
    setSearchTerm("");
    setPaymentStatusFilter("all");
    setStartDate("");
    setEndDate("");
    setSelectedState("all");
    setSelectedLGA("all");
    setOrgFilter("all");
    setApprovalFilter("all");
    setSalesModelFilter("all");
    setSelectedMonth("all");
    setYearFilter("all");
    setTrackingFilter("none");
  };

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
        toast.warning("Nothing to export", "No sales match the current filters.");
        return;
      }

      let exportData = result.data;
      if (approvalFilter !== "all") {
        exportData = exportData.filter((s: any) =>
          approvalFilter === "approved" ? s.agent_approved : !s.agent_approved,
        );
      }
      if (salesModelFilter !== "all") {
        exportData = exportData.filter((s: any) => s.payment_model_id === salesModelFilter);
      }
      if (selectedYears.length > 0 && selectedYears.length < availableYears.length) {
        exportData = exportData.filter((s: any) => {
          const d = s.sales_date || s.created_at;
          return d && selectedYears.includes(new Date(d).getFullYear());
        });
      }

      const { exportSalesDataToCSV } = await import("@/utils/csvExportUtils");
      exportSalesDataToCSV(exportData, `sales-export-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      // A try/finally with no catch: the spinner stopped and nothing else
      // happened, and the rejection went unhandled.
      console.error("Sales export failed:", err);
      toast.error(
        "The export did not run",
        err instanceof Error ? err.message : "The sales could not be fetched. Try again.",
      );
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (onExportReady) onExportReady(handleExport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchTerm,
    paymentStatusFilter,
    startDate,
    endDate,
    selectedState,
    selectedLGA,
    orgFilter,
    approvalFilter,
    salesModelFilter,
    selectedYears,
    availableYears,
  ]);

  const handlePaymentSuccess = () => {
    setPaymentModalSale(null);
    report.refetch();
  };

  return (
    <div className="space-y-4">
      {report.error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          The sales could not be loaded: {report.error}. What is shown may be from an earlier load.
        </div>
      )}

      {report.isPending ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading sales data...</span>
        </div>
      ) : (
        <>
          {/* The money over everything the filters allow, from SQL. */}
          <FinancialSummaryCards summary={financialSummary} />

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
            selectedState={viewFrom === "superAdmin" ? selectedState : undefined}
            onStateChange={
              viewFrom === "superAdmin"
                ? (val) => {
                    setSelectedState(val);
                    setSelectedLGA("all");
                  }
                : undefined
            }
            selectedLGA={viewFrom === "superAdmin" ? selectedLGA : undefined}
            onLGAChange={viewFrom === "superAdmin" ? setSelectedLGA : undefined}
            stateList={stateList}
            lgaList={lgaList}
            orgFilter={viewFrom === "acsl_agent" ? orgFilter : undefined}
            onOrgChange={viewFrom === "acsl_agent" ? setOrgFilter : undefined}
            approvalFilter={viewFrom === "acsl_agent" ? approvalFilter : undefined}
            onApprovalChange={viewFrom === "acsl_agent" ? setApprovalFilter : undefined}
            salesModelFilter={salesModelFilter}
            onSalesModelChange={setSalesModelFilter}
            salesModels={salesModels}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            yearFilter={yearFilter}
            onYearFilterChange={setYearFilter}
            availableYears={availableYears}
            assignedOrgs={viewFrom === "acsl_agent" ? assignedOrgs : []}
          />

          {/* A chip is a server filter: its badge and the footer count the same rows. */}
          <SalesTrackingBar
            active={trackingFilter}
            counts={trackingCounts}
            totalCount={report.summary.total}
            onChange={setTrackingFilter}
          />

          <FinancialReportsTable
            data={report.rows}
            loading={report.isFetching}
            currentPage={currentPage}
            pageSize={pageSize}
            totalRecords={report.total}
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
          <span className="sr-only">{exporting ? "Exporting" : ""}</span>
        </>
      )}

      <AdminSalesDetailModal
        open={!!detailModalSale}
        onClose={() => setDetailModalSale(null)}
        sale={detailModalSale}
        viewFrom={viewFrom === "superAdmin" ? "superAdmin" : "admin"}
        onSaleUpdated={report.refetch}
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


import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import FinancialReportsView from "../../admin/components/financial-reports/FinancialReportsView";
import adminSalesService from "../../services/adminSalesService";
import superAdminAgentService from "../../services/superAdminAgentService";
import { AdminSales } from "@/types/adminSales";

const DARK_NAVY = "#07376a";

const CARD_LABELS: Record<string, string> = {
  stovesReceived: "Total Stoves Received by Partner",
  stovesSold: "Total Stoves Sold to End Users",
  availableStoves: "Available Stoves for Sale to End Users",
  expectedReceivable: "Expected Receivable Amount",
  amountReceived: "Amount Received",
  outstandingBalance: "Outstanding Balance",
};

interface StoveItem {
  id: string;
  stove_id: string;
  status: string;
  created_at: string;
  sale_id?: string;
  sale_date?: string;
}

interface Props {
  activeCard: string;
  organizationId: string | null;
  year: number;
  dateFrom: string | null;
  dateTo: string | null;
  onClose: () => void;
  onCreateSale: () => void;
  onEditSale?: (sale: AdminSales) => void;
  onDeleteSale?: (sale: AdminSales) => void;
}

const statusBadge = (status: string) => {
  switch (status?.toLowerCase()) {
    case "available": return "bg-green-100 text-green-800 border-green-200";
    case "sold":      return "bg-blue-100 text-blue-800 border-blue-200";
    default:          return "bg-gray-100 text-gray-600 border-gray-200";
  }
};

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch { return "—"; }
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function PartnerDashboardTableSection({
  activeCard,
  organizationId,
  year,
  dateFrom,
  dateTo,
  onClose,
  onCreateSale,
  onEditSale,
  onDeleteSale,
}: Props) {
  const isStoveCard = activeCard === "stovesReceived" || activeCard === "availableStoves";

  const [stoves, setStoves] = useState<StoveItem[]>([]);
  const [stovesLoading, setStovesLoading] = useState(false);
  const [stovesError, setStovesError] = useState<string | null>(null);

  // Pagination state for stove table
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (!isStoveCard) return;
    let cancelled = false;
    const fetchStoves = async () => {
      setStovesLoading(true);
      setStovesError(null);
      setCurrentPage(1);
      try {
        const status = activeCard === "availableStoves" ? "available" : null;
        // Partners have a single org_id → use get-stove-ids.
        // ACSL agents manage multiple orgs → use get-agent-stove-ids.
        const result = organizationId
          ? await (adminSalesService as any).getAvailableStoveIds(organizationId, status)
          : await (superAdminAgentService as any).getAgentStoveIds({ status: status ?? undefined });
        if (!cancelled) {
          if (result.success) setStoves(result.data || []);
          else setStovesError(result.error || result.message || "Failed to load stove IDs");
        }
      } catch (err: any) {
        if (!cancelled) setStovesError(err.message || "An error occurred");
      } finally {
        if (!cancelled) setStovesLoading(false);
      }
    };
    fetchStoves();
    return () => { cancelled = true; };
  }, [activeCard, organizationId, isStoveCard]);

  const totalRecords = stoves.length;
  const totalPages = Math.ceil(totalRecords / pageSize);
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);
  const pageStoves = useMemo(
    () => stoves.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [stoves, currentPage, pageSize]
  );

  const getVisiblePages = () => {
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const loadSales = useCallback(async () => {
    const from = dateFrom || `${year}-01-01`;
    const to   = dateTo   || `${year}-12-31`;
    const paymentStatus = activeCard === "amountReceived" ? "paid" : undefined;
    return adminSalesService.getFinancialReportSales({
      limit: 1000,
      dateFrom: from,
      dateTo: to,
      ...(paymentStatus ? { paymentStatus } : {}),
    });
  }, [activeCard, year, dateFrom, dateTo]);

  const initialPaymentStatus =
    activeCard === "amountReceived"    ? "paid"    :
    activeCard === "outstandingBalance" ? "partial" :
    undefined;

  const label = CARD_LABELS[activeCard] ?? activeCard;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Section header — same navy as sales table */}
      <div
        className="flex items-center justify-between px-4 py-2.5 text-white"
        style={{ backgroundColor: DARK_NAVY }}
      >
        <span className="text-sm font-semibold">{label}</span>
        <div className="flex items-center gap-2">
          {activeCard === "availableStoves" && (
            <Button
              size="sm"
              className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white border-0"
              onClick={onCreateSale}
            >
              + Create Sale
            </Button>
          )}
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isStoveCard ? (
        stovesLoading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading stove IDs…</span>
          </div>
        ) : stovesError ? (
          <div className="py-8 text-center text-red-500 text-sm">{stovesError}</div>
        ) : stoves.length === 0 ? (
          <div className="flex flex-col py-10 items-center justify-center">
            <p className="text-lg font-medium text-gray-500">No stove IDs found</p>
            <p className="text-sm text-gray-400">No stoves have been assigned to this account yet.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {/* Pagination header — matches FinancialReportsTable */}
            <div className="bg-blue-50 rounded-t-none px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
                  <span className="font-medium">{totalRecords}</span> records
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}
                  >
                    <SelectTrigger className="w-[65px] h-7 bg-white text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-sm font-bold text-green-500">
                Total Stoves: <span className="text-brand">{totalRecords}</span>
              </p>
            </div>

            {/* Table — same bg-brand header / bg-brand-light alternating rows */}
            <div className="bg-white border-x border-gray-200 overflow-x-auto mt-5">
              <Table>
                <TableHeader className="bg-brand">
                  <TableRow className="hover:bg-brand">
                    <TableHead className="text-white font-semibold py-4 whitespace-nowrap">#</TableHead>
                    <TableHead className="text-white font-semibold py-4 whitespace-nowrap">Stove ID</TableHead>
                    <TableHead className="text-white font-semibold py-4 whitespace-nowrap">Status</TableHead>
                    <TableHead className="text-white font-semibold py-4 whitespace-nowrap">Date Received</TableHead>
                    <TableHead className="text-white font-semibold py-4 whitespace-nowrap">Sale Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageStoves.map((stove, i) => {
                    const rowNum = (currentPage - 1) * pageSize + i + 1;
                    return (
                      <TableRow
                        key={stove.id}
                        className={i % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-brand-light hover:bg-gray-50"}
                      >
                        <TableCell className="font-medium">{rowNum}</TableCell>
                        <TableCell className="font-mono font-medium">{stove.stove_id}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${statusBadge(stove.status)}`}>
                            {stove.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{fmtDate(stove.created_at)}</TableCell>
                        <TableCell>{fmtDate(stove.sale_date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination footer */}
            {totalPages > 1 && (
              <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
                <p className="text-sm text-gray-600">
                  Page <span className="font-medium">{currentPage}</span> of{" "}
                  <span className="font-medium">{totalPages}</span>
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline" size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline" size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  {getVisiblePages().map((p) => (
                    <Button
                      key={p}
                      variant={p === currentPage ? "default" : "outline"}
                      size="sm"
                      className={`h-7 w-7 text-xs ${p === currentPage ? "bg-brand text-white hover:bg-brand/90" : ""}`}
                      onClick={() => setCurrentPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                  <Button
                    variant="outline" size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline" size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        <FinancialReportsView
          loadSales={loadSales}
          onEditSale={onEditSale}
          onDeleteSale={onDeleteSale}
          viewFrom="admin"
          initialPaymentStatus={initialPaymentStatus}
        />
      )}
    </div>
  );
}

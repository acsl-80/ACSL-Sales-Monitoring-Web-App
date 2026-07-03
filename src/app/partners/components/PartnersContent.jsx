
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";
import DashboardLayout from "../../components/DashboardLayout";
import OrganizationFormModal from "../../components/OrganizationFormModal";
import OrganizationDetailSidebar from "../../components/OrganizationDetailSidebar";
import DeleteConfirmationModal from "../../components/DeleteConfirmationModal";
import OrganizationCSVImportModal from "../../components/OrganizationCSVImportModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import useOrganizations from "../../hooks/useOrganizations";
import { useAuth } from "../../contexts/useAuth";
import { usePermissions } from "../../hooks/usePermissions";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { lgaAndStates } from "../../constants";
import superAdminAgentService from "../../services/superAdminAgentService";
import PageHeader from "../../components/PageHeader";
import {
  Search,
  X,
  Building2,
  Loader2,
  Edit,
  Package,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  ChevronDown,
  ChevronUp,
  Tag,
  TrendingUp,
  Boxes,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { downloadTableAsCSV } from "@/utils/csvExportUtils";
import AddPartnerModal from "../components/AddPartnerModal";
import MonthlySalesChart from "./MonthlySalesChart";
import SalesByStateChart from "./SalesByStateChart";
import SalesByModelsChart from "./SalesByModelsChart";
import EditPartnerModal from "../components/EditPartnerModal";
import AssignAgentModal from "../components/AssignAgentModal";
import AdminSalesDetailModal from "../../admin/components/sales/AdminSalesDetailModal";
import ViewCredentialModal from "../../admin/components/credentials/ViewCredentialModal";
import adminCredentialsService from "../../services/adminCredentialsService";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ── Stove IDs Modal ──────────────────────────────────────────────────────────

const FILTER_LABELS = { all: "All Stove IDs", available: "Available Stove IDs", sold: "Sold Stove IDs" };

const STOVE_PAGE_SIZE = 200;

const StoveIdsModal = ({ organization, isOpen, onClose, initialFilter = "all" }) => {
  const { supabase } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stoveIds, setStoveIds] = useState([]);
  const [totals, setTotals] = useState(null);
  const [statusFilter, setStatusFilter] = useState(initialFilter);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [selectedSale, setSelectedSale] = useState(null);
  const [loadingSaleId, setLoadingSaleId] = useState(null);
  const [stovePage, setStovePage] = useState(1);
  const [stoveTotal, setStoveTotal] = useState(0);

  useEffect(() => {
    if (isOpen && organization) {
      setSearch("");
      setStovePage(1);
      setStatusFilter(initialFilter);
      fetchStoveIds(initialFilter, 1);
    }
  }, [isOpen, organization]);

  const handleStatusChange = (val) => {
    setStatusFilter(val);
    setStovePage(1);
    fetchStoveIds(val, 1);
  };

  const fetchStoveIds = async (sf, page = stovePage) => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const offset = (page - 1) * STOVE_PAGE_SIZE;
      const body = { organization_id: organization.id, limit: STOVE_PAGE_SIZE, offset };
      if (sf && sf !== "all") body.status = sf;
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-stove-ids`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to fetch stove IDs");
      setStoveIds(data.data || []);
      setTotals(data.totals || null);
      setStoveTotal(data.pagination?.total ?? data.totals?.total_stove_ids ?? 0);
    } catch (err) {
      setError(err.message);
      setStoveIds([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStovePage = (p) => {
    setStovePage(p);
    fetchStoveIds(statusFilter, p);
  };

  const handleViewSale = async (saleId) => {
    setLoadingSaleId(saleId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-sale?id=${saleId}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to fetch sale");
      setSelectedSale(data.data || null);
    } catch (err) {
      toast({ variant: "error", title: "Failed to fetch sale", description: err.message });
    } finally {
      setLoadingSaleId(null);
    }
  };

  const formatDate = (d) => {
    if (!d) return "N/A";
    try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return "N/A"; }
  };

  const filtered = stoveIds.filter((s) =>
    !search || s.stove_id?.toLowerCase().includes(search.toLowerCase())
  );

  const stoveTotalPages = Math.max(1, Math.ceil(stoveTotal / STOVE_PAGE_SIZE));

  const totalCount = totals?.total_stove_ids ?? 0;
  const available = totals?.total_stove_available ?? 0;
  const sold = totals?.total_stove_sold ?? 0;
  const soldPct = totalCount > 0 ? Math.round((sold / totalCount) * 100) : 0;
  const availPct = totalCount > 0 ? Math.round((available / totalCount) * 100) : 0;

  const fileSlug = `${organization?.partner_name?.replace(/\s+/g, "-").toLowerCase() ?? "partner"}-${statusFilter}`;

  const downloadCSV = () => {
    const headers = ["Stove ID", "Status", "Assigned Date", "Sale Date"];
    const rows = filtered.map((s) => [
      s.stove_id,
      s.status === "sold" ? "Sold" : "Available",
      formatDate(s.created_at),
      s.status === "sold" ? formatDate(s.sale_date) : "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stove-ids-${fileSlug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = async () => {
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF();
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(`${FILTER_LABELS[statusFilter]}`, 14, 15);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Partner: ${organization?.partner_name}   |   Generated: ${new Date().toLocaleDateString("en-GB")}`, 14, 22);
      autoTable(doc, {
        head: [["Stove ID", "Status", "Assigned Date", "Sale Date"]],
        body: filtered.map((s) => [
          s.stove_id,
          s.status === "sold" ? "Sold" : "Available",
          formatDate(s.created_at),
          s.status === "sold" ? formatDate(s.sale_date) : "—",
        ]),
        startY: 27,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [7, 55, 106] },
        alternateRowStyles: { fillColor: [240, 245, 255] },
      });
      doc.save(`stove-ids-${fileSlug}.pdf`);
    } catch (err) {
      toast({ variant: "error", title: "PDF export failed", description: err.message });
    }
  };

  const SectionHeader = ({ title, children }) => (
    <div className="flex items-center justify-between border-b border-primary/20 pb-0.5 mb-2">
      <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );

  const DetailItem = ({ label, value }) => (
    <div className="space-y-0">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xs font-medium">{value ?? <span className="text-muted-foreground">N/A</span>}</p>
    </div>
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          {/* Header */}
          <DialogHeader className="px-5 py-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
            <div>
              <DialogTitle className="text-base font-bold text-foreground">{FILTER_LABELS[statusFilter]}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Partner: <span className="font-semibold text-primary">{organization?.partner_name}</span>
              </p>
            </div>
          </DialogHeader>

          {/* Content */}
          <div className="px-5 py-3 space-y-3 overflow-y-auto flex-1">
            {/* Summary — mirrors Payment Details section style */}
            {totals && (
              <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                <SectionHeader title="Stove Summary" />
                <div className="grid grid-cols-3 gap-2">
                  <DetailItem label="Total Assigned" value={totalCount.toLocaleString()} />
                  <DetailItem
                    label="Available"
                    value={
                      <span className="text-green-700">
                        {available.toLocaleString()}
                        <span className="text-[10px] font-normal text-green-600 ml-1">({availPct}%)</span>
                      </span>
                    }
                  />
                  <DetailItem
                    label="Sold"
                    value={
                      <span className="text-blue-700">
                        {sold.toLocaleString()}
                        <span className="text-[10px] font-normal text-blue-600 ml-1">({soldPct}%)</span>
                      </span>
                    }
                  />
                </div>
              </div>
            )}

            {/* Filter */}
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <SectionHeader title="Filter & Search" />
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search stove ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs bg-background"
                  />
                </div>
                <Select value={statusFilter} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-[130px] h-8 text-xs bg-background">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="sold">Sold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Stove IDs */}
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <SectionHeader title={`Stove IDs${stoveTotal > 0 ? ` (${stoveTotal.toLocaleString()} total)` : ""}`}>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    onClick={downloadCSV}
                    disabled={loading || filtered.length === 0}
                  >
                    <Download className="h-3 w-3" />CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    onClick={downloadPDF}
                    disabled={loading || filtered.length === 0}
                  >
                    <Download className="h-3 w-3" />PDF
                  </Button>
                </div>
              </SectionHeader>

              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : error ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-red-600 text-sm">{error}</p>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => fetchStoveIds(statusFilter)}>
                    Retry
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-muted-foreground py-6 text-sm">No stove IDs found.</div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 md:grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
                    {filtered.map((stove) => (
                      <button
                        key={stove.id}
                        onClick={() => stove.sale_id && handleViewSale(stove.sale_id)}
                        disabled={!!loadingSaleId || !stove.sale_id}
                        className={[
                          "px-2 py-1 text-xs rounded border text-center truncate transition-colors",
                          stove.status === "sold"
                            ? "bg-green-800 border-green-800 text-white hover:bg-green-700 cursor-pointer"
                            : "bg-muted/50 border-border/50 text-foreground cursor-default",
                          stove.sale_id && loadingSaleId === stove.sale_id ? "opacity-60" : "",
                        ].join(" ")}
                        title={stove.status === "sold" ? `${stove.stove_id} — Sold${stove.sale_id ? " (click to view sale)" : ""}` : `${stove.stove_id} — Available`}
                      >
                        {stove.sale_id && loadingSaleId === stove.sale_id
                          ? <Loader2 className="h-3 w-3 animate-spin inline" />
                          : stove.stove_id}
                      </button>
                    ))}
                  </div>
                  {stoveTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/40">
                      <p className="text-[10px] text-muted-foreground">
                        Page {stovePage} of {stoveTotalPages} — showing {((stovePage - 1) * STOVE_PAGE_SIZE) + 1}–{Math.min(stovePage * STOVE_PAGE_SIZE, stoveTotal)} of {stoveTotal.toLocaleString()}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0" onClick={() => handleStovePage(1)} disabled={stovePage === 1}>
                          <ChevronsLeft className="h-3 w-3" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => handleStovePage(stovePage - 1)} disabled={stovePage === 1}>
                          <ChevronLeft className="h-3 w-3 mr-0.5" />Prev
                        </Button>
                        <span className="text-[10px] font-semibold text-primary px-1">{stovePage}</span>
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => handleStovePage(stovePage + 1)} disabled={stovePage >= stoveTotalPages}>
                          Next<ChevronRight className="h-3 w-3 ml-0.5" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0" onClick={() => handleStovePage(stoveTotalPages)} disabled={stovePage >= stoveTotalPages}>
                          <ChevronsRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {selectedSale && (
        <AdminSalesDetailModal open={!!selectedSale} onClose={() => setSelectedSale(null)} sale={selectedSale} viewFrom="superAdmin" />
      )}
    </>
  );
};

// ── Stove Transfer History Modal ──────────────────────────────────────────────

const StoveTransferHistoryModal = ({ organization, isOpen, onClose }) => {
  const { supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [error, setError] = useState(null);
  const [expandedStoveIds, setExpandedStoveIds] = useState(null); // { transactionId, stoveIds }
  const [stoveSearch, setStoveSearch] = useState("");

  useEffect(() => { if (!expandedStoveIds) setStoveSearch(""); }, [expandedStoveIds]);

  useEffect(() => {
    if (isOpen && organization) {
      fetchHistory();
    }
  }, [isOpen, organization]);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({ limit: "200", offset: "0" });
      if (organization.partner_id) params.set("search", organization.partner_id);
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-transfer-history?${params}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to fetch transfer history");
      setRecords(data.data || []);
    } catch (err) {
      setError(err.message);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return "N/A";
    try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return "N/A"; }
  };

  const SectionHeader = ({ title }) => (
    <div className="flex items-center justify-between border-b border-primary/20 pb-0.5 mb-2">
      <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">{title}</h3>
    </div>
  );

  const totalStoves = records.reduce((sum, r) => sum + (r.stove_count ?? (r.stove_ids?.length ?? 0)), 0);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col border-0 shadow-2xl">
          <DialogHeader className="px-6 py-4 bg-[#4a5d0f] border-b border-[#3a4a0c] shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-lg font-bold text-white tracking-tight">Purchases from ACSL</DialogTitle>
                <p className="text-xs text-[#eef3c4] mt-1">
                  Partner: <span className="font-semibold text-white">{organization?.partner_name}</span>
                </p>
              </div>
              {!loading && records.length > 0 && (
                <div className="flex gap-2 mr-8">
                  <div className="bg-white/10 border border-white/20 rounded-md px-3 py-1.5 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-[#eef3c4]">Transactions</div>
                    <div className="text-sm font-bold text-white">{records.length}</div>
                  </div>
                  <div className="bg-white/10 border border-white/20 rounded-md px-3 py-1.5 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-[#eef3c4]">Total Stoves</div>
                    <div className="text-sm font-bold text-white">{totalStoves}</div>
                  </div>
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 bg-[#fafcfd] p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[#4a5d0f]" />
              </div>
            ) : error ? (
              <div className="text-center py-10 space-y-2">
                <p className="text-red-600 text-sm">{error}</p>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={fetchHistory}>Retry</Button>
              </div>
            ) : records.length === 0 ? (
              <div className="text-center text-muted-foreground py-16 text-sm">No purchases found for this partner.</div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
                        <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Transaction ID</TableHead>
                        <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Date</TableHead>
                        <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Sales Factory</TableHead>
                        
                        <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Sales Rep</TableHead>
                        <TableHead className="text-white font-semibold text-xs whitespace-nowrap text-center">Stoves</TableHead>
                        <TableHead className="text-white font-semibold text-xs whitespace-nowrap text-right">Stove IDs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((record, idx) => {
                        const stoveIds = record.stove_ids ?? [];
                        const count = record.stove_count ?? stoveIds.length;
                        const factory = record.sales_factory || stoveIds[0]?.factory || "—";
                        const salesRep = record.sales_rep || record.sales_rep_name || record.created_by_name || "—";
                        return (
                          <TableRow key={record.id || idx} className={idx % 2 === 0 ? "bg-white" : "bg-[#eef3c4]/40"}>
                            <TableCell className="text-xs font-mono font-medium text-gray-900">{record.transaction_id || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap text-gray-700">{formatDate(record.transfer_date)}</TableCell>
                            <TableCell className="text-xs text-gray-700">{factory}</TableCell>
                            <TableCell className="text-xs text-gray-700">{salesRep}</TableCell>
                            <TableCell className="text-xs text-center">
                              <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-[#eef3c4] text-[#4a5d0f] font-semibold">
                                {count}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                disabled={stoveIds.length === 0}
                                onClick={() => setExpandedStoveIds({ transactionId: record.transaction_id, stoveIds, factory })}
                                className="h-7 px-3 text-xs rounded-none bg-[#4a5d0f] hover:bg-[#3a4a0c] text-white"
                              >
                                View Stove IDs
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* All Stove IDs sub-modal */}
      <Dialog open={!!expandedStoveIds} onOpenChange={() => setExpandedStoveIds(null)}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col border-0 shadow-2xl">
          <DialogHeader className="px-6 py-4 bg-[#4a5d0f] border-b border-[#3a4a0c] shrink-0">
            <div>
              <DialogTitle className="text-lg font-bold text-white tracking-tight">Stove IDs</DialogTitle>
              <p className="text-xs text-[#eef3c4] mt-1">
                Transaction: <span className="font-semibold text-white font-mono">{expandedStoveIds?.transactionId}</span>
                {expandedStoveIds?.factory && expandedStoveIds.factory !== "—" && (
                  <> · Factory: <span className="font-semibold text-white">{expandedStoveIds.factory}</span></>
                )}
                <span className="ml-2 bg-white/15 border border-white/20 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                  {expandedStoveIds?.stoveIds.length} stoves
                </span>
              </p>
            </div>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 bg-[#fafcfd] p-5">
            {(() => {
              const all = expandedStoveIds?.stoveIds ?? [];
              const q = stoveSearch.trim().toLowerCase();
              const filtered = q ? all.filter((s) => s.stove_id?.toLowerCase().includes(q)) : all;
              return (
                <>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <Input
                        value={stoveSearch}
                        onChange={(e) => setStoveSearch(e.target.value)}
                        placeholder="Search stove IDs..."
                        className="pl-9 h-9 text-xs bg-white border-gray-200 focus-visible:ring-[#4a5d0f]"
                      />
                    </div>
                    <span className="text-xs text-gray-600 whitespace-nowrap">
                      {filtered.length} of {all.length}
                    </span>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-10">No matching stove IDs.</div>
                  ) : (
                    <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
                      {filtered.map((s) => (
                        <span
                          key={s.stove_id}
                          className="px-2 py-1.5 text-xs rounded border text-center truncate bg-white border-[#eef3c4] text-[#4a5d0f] font-mono hover:bg-[#eef3c4]/50 transition-colors"
                          title={[s.stove_id, s.factory && `Factory: ${s.factory}`, s.sales_reference && `Ref: ${s.sales_reference}`].filter(Boolean).join(" · ")}
                        >
                          {s.stove_id}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Assigned Agents Modal ─────────────────────────────────────────────────────

const AssignedAgentsModal = ({ organization, agents, isOpen, onClose }) => {
  const [agentSearch, setAgentSearch] = useState("");

  if (!organization) return null;

  const partnerTotalStoves = organization.total_stove_ids ?? 0;
  const partnerSoldStoves = organization.sold_stove_ids ?? 0;
  const agentsWithPartnerSales = agents.map((agent) => ({
    ...agent,
    partnerSoldCount: agent.partner_sold_stoves_count ?? agent.partner_sales_count ?? 0,
  }));
  const rankedAgents = [...agentsWithPartnerSales].sort((a, b) => b.partnerSoldCount - a.partnerSoldCount);

  const filteredRankedAgents = agentSearch.trim()
    ? rankedAgents.filter((a) =>
        (a.full_name || a.name || "").toLowerCase().includes(agentSearch.toLowerCase()) ||
        (a.email || "").toLowerCase().includes(agentSearch.toLowerCase())
      )
    : rankedAgents;

  const isFiltered = agentSearch.trim().length > 0;
  const statTotalAssigned = partnerTotalStoves;
  const statTotalRecorded = isFiltered
    ? filteredRankedAgents.reduce((sum, a) => sum + a.partnerSoldCount, 0)
    : partnerSoldStoves;

  // const topAgent = rankedAgents[0];
  // const lowestAgent = [...rankedAgents].reverse().find((agent) => agent.partnerSoldCount > 0) || rankedAgents[rankedAgents.length - 1];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${agents.length > 1 ? "max-w-4xl" : "max-w-2xl"} w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col`}>
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <div>
            <DialogTitle className="text-base font-bold text-foreground">Assigned Agents</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Partner: <span className="font-semibold text-primary">{organization.partner_name}</span>
              <span className="ml-2 bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5 rounded-full">{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
            </p>
          </div>
        </DialogHeader>

        {/* Compact stats + filter — only when there are multiple agents */}
        {agents.length > 1 && (
          <div className="px-5 py-2.5 border-b bg-muted/20 flex flex-wrap items-center gap-3 shrink-0">
            {/* Stat cards */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="rounded border border-[#07376a]/30 bg-[#07376a]/10 px-3 py-1.5 flex items-center gap-2">
                <span className="text-xs font-bold text-[#07376a]">{statTotalAssigned.toLocaleString()}</span>
                <span className="text-[10px] text-[#07376a]/70 font-medium">Total Stoves Assigned to Partner</span>
              </div>
              <div className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700">{statTotalRecorded.toLocaleString()}</span>
                <span className="text-[10px] text-blue-600/80 font-medium">Total Recorded{isFiltered ? " (filtered)" : ""}</span>
              </div>
            </div>
            {/* Agent filter */}
            <div className="relative ml-auto min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter by agent..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="pl-8 h-7 text-xs bg-white"
              />
              {agentSearch && (
                <button onClick={() => setAgentSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1">
          {agents.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">No agents assigned to this partner.</div>
          ) : agents.length === 1 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-brand hover:bg-brand">
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Full Name</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Phone Number</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-white">
                    <TableCell className="text-xs font-medium text-gray-900">{agents[0].full_name || agents[0].name || "—"}</TableCell>
                    <TableCell className="text-xs text-gray-700">{agents[0].phone || "—"}</TableCell>
                    <TableCell className="text-xs text-gray-700">{agents[0].email || "—"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : filteredRankedAgents.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">No agents match your search.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-brand hover:bg-brand">
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Rank</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Agent</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Stoves Received</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Stove Attended</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Stove Unattended</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRankedAgents.map((agent, idx) => (
                    <TableRow key={agent.id || idx} className={idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"}>
                      <TableCell className="text-xs font-bold text-gray-700">#{idx + 1}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-xs font-medium text-gray-900">{agent.full_name || agent.name || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{agent.email || "—"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {agent.partnerSoldCount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          {(agent.partner_attended_count ?? 0).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          {(agent.partner_unattended_count ?? 0).toLocaleString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Partner Detail Modal ──────────────────────────────────────────────────────

const DetailItem = ({ label, value, span2 = false }) => (
  <div className={`space-y-0.5 ${span2 ? "md:col-span-2" : ""}`}>
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
    <p className="text-xs font-medium text-gray-900">{value || <span className="text-gray-400">N/A</span>}</p>
  </div>
);

const SectionCard = ({ title, children }) => (
  <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-1 mb-3">{title}</h3>
    {children}
  </div>
);

const PartnerDetailModal = ({ organization, isOpen, onClose, onEdit }) => {
  if (!organization) return null;
  const formatDate = (d) => {
    if (!d) return "N/A";
    try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return "N/A"; }
  };
  const typeLabel = organization.partner_type
    ? organization.partner_type.charAt(0).toUpperCase() + organization.partner_type.slice(1)
    : "N/A";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold">Partner Details</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{organization.partner_name}</p>
            </div>
            {organization.status && (
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${organization.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                {organization.status.charAt(0).toUpperCase() + organization.status.slice(1)}
              </span>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <SectionCard title="Partner Information">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DetailItem label="Partner Name" value={organization.partner_name} />
              <DetailItem label="Partner ID" value={organization.partner_id} />
              <DetailItem label="Type" value={typeLabel} />
              <DetailItem label="Branch" value={organization.branch} />
              <DetailItem label="State" value={organization.state} />
              <DetailItem label="Date Joined" value={formatDate(organization.created_at)} />
            </div>
          </SectionCard>
          <SectionCard title="Contact Information">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DetailItem label="Contact Person" value={organization.contact_person} />
              <DetailItem label="Contact Phone" value={organization.contact_phone} />
              <DetailItem label="Alternative Phone" value={organization.alternative_phone} />
              <DetailItem label="Email" value={organization.email} />
              <DetailItem label="Address" value={organization.address} span2 />
            </div>
          </SectionCard>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── System-Wide Stoves KPI Modal (Purchased / Sold / Unsold) ─────────────────

const ROLE_SHORT = {
  super_admin: "SA",
  acsl_agent_manager: "AGM",
  acsl_agent: "AGENT",
  partner: "PARTNER",
  partner_agent: "PAGENT",
};

const toSuperscript = (label) => {
  const map = {
    A: "ᴬ", B: "ᴮ", C: "ᶜ", D: "ᴰ", E: "ᴱ", F: "ᶠ", G: "ᴳ", H: "ᴴ",
    I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ", P: "ᴾ",
    R: "ᴿ", S: "ˢ", T: "ᵀ", U: "ᵁ", V: "ⱽ", W: "ᵂ", X: "ˣ", Y: "ʸ", Z: "ᶻ",
  };
  return label.split("").map((c) => map[c] || c).join("");
};

const SystemStovesModal = ({ isOpen, onClose, mode }) => {
  const { supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const title =
    mode === "purchased" ? "Stoves Purchased from ACSL" :
    mode === "sold"      ? "Total Stoves Sold" :
                           "Total Unsold Stoves";

  const filenamePrefix =
    mode === "purchased" ? "stoves-purchased" :
    mode === "sold"      ? "stoves-sold" :
                           "stoves-unsold";

  const showSoldCols = mode === "sold";

  useEffect(() => {
    if (!isOpen) return;
    setSearch("");
    setPage(1);
    setRows([]);
    setError(null);
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Fetch stove_ids across the whole system, matching the KPI filter.
        const stoveRows = [];
        const PAGE_FETCH = 1000;
        const HARD_CAP = 50000;
        let from = 0;
        while (from < HARD_CAP) {
          let q = supabase
            .from("stove_ids")
            .select("stove_id,organization_id,status,created_at,sale_id")
            .eq("is_archived", false);
          if (mode === "sold")   q = q.eq("status", "sold");
          if (mode === "unsold") q = q.eq("status", "available");
          const { data, error: err } = await q.range(from, from + PAGE_FETCH - 1);
          if (err) throw err;
          const chunk = data || [];
          stoveRows.push(...chunk);
          if (chunk.length < PAGE_FETCH) break;
          from += PAGE_FETCH;
        }

        // 2. Resolve organizations (partner name / state / branch) in batches.
        const orgIds = Array.from(new Set(stoveRows.map((s) => s.organization_id).filter(Boolean)));
        const orgMap = {};
        const OBATCH = 200;
        for (let i = 0; i < orgIds.length; i += OBATCH) {
          const slice = orgIds.slice(i, i + OBATCH);
          const { data: orgs, error: oErr } = await supabase
            .from("organizations")
            .select("id,partner_name,state,branch")
            .in("id", slice);
          if (oErr) throw oErr;
          (orgs || []).forEach((o) => {
            orgMap[o.id] = { name: o.partner_name || "—", state: o.state || "—", branch: o.branch || "—" };
          });
        }

        // 3. For sold mode, resolve sale_date + seller (name + role).
        const saleMap = {};        // sale_id -> { sales_date, created_by }
        const sellerMap = {};      // user_id -> { name, role }
        if (mode === "sold") {
          const saleIds = Array.from(new Set(stoveRows.map((s) => s.sale_id).filter(Boolean)));
          const SBATCH = 200;
          for (let i = 0; i < saleIds.length; i += SBATCH) {
            const slice = saleIds.slice(i, i + SBATCH);
            const { data: sales, error: sErr } = await supabase
              .from("sales")
              .select("id,sales_date,created_at,created_by")
              .in("id", slice);
            if (sErr) throw sErr;
            (sales || []).forEach((s) => {
              saleMap[s.id] = { sales_date: s.sales_date || s.created_at || null, created_by: s.created_by };
            });
          }
          const userIds = Array.from(new Set(Object.values(saleMap).map((s) => s.created_by).filter(Boolean)));
          const UBATCH = 200;
          for (let i = 0; i < userIds.length; i += UBATCH) {
            const slice = userIds.slice(i, i + UBATCH);
            const { data: profs, error: pErr } = await supabase
              .from("profiles")
              .select("id,full_name,role")
              .in("id", slice);
            if (pErr) throw pErr;
            (profs || []).forEach((p) => {
              sellerMap[p.id] = { name: p.full_name || "—", role: p.role || "" };
            });
          }
        }

        // 4. Build rows.
        const collected = stoveRows.map((s) => {
          const meta = orgMap[s.organization_id] || { name: "—", state: "—", branch: "—" };
          const base = {
            stove_id: s.stove_id,
            partner_name: meta.name,
            state: meta.state,
            branch: meta.branch,
            status: s.status,
            created_at: s.created_at,
          };
          if (mode === "sold") {
            const sale = saleMap[s.sale_id];
            const seller = sale ? sellerMap[sale.created_by] : null;
            base.sales_date = sale?.sales_date || null;
            base.seller_name = seller?.name || "—";
            base.seller_role = seller?.role || "";
          }
          return base;
        });
        collected.sort((a, b) => String(a.stove_id).localeCompare(String(b.stove_id)));
        if (!cancelled) setRows(collected);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load stoves");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, mode, supabase]);

  useEffect(() => { setPage(1); }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.stove_id).toLowerCase().includes(q) ||
      (r.partner_name || "").toLowerCase().includes(q) ||
      (r.state || "").toLowerCase().includes(q) ||
      (r.branch || "").toLowerCase().includes(q) ||
      (r.status || "").toLowerCase().includes(q) ||
      (r.seller_name || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const fmtDate = (d) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return "—"; }
  };

  const exportCsv = () => {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = showSoldCols
      ? ["Stove ID", "Partner Name", "State", "Branch", "Sales Date", "Sold By", "Role"]
      : ["Stove ID", "Partner Name", "State", "Branch", "Status", "Date Received"];
    const body = filtered.map((r) => showSoldCols
      ? [r.stove_id, r.partner_name, r.state, r.branch, fmtDate(r.sales_date), r.seller_name, ROLE_SHORT[r.seller_role] || r.seller_role || ""].map(esc).join(",")
      : [r.stove_id, r.partner_name, r.state, r.branch, r.status || "", fmtDate(r.created_at)].map(esc).join(",")
    );
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

  const colCount = showSoldCols ? 6 : 6;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={showSoldCols
                ? "Search stove ID, partner, state, branch or seller..."
                : "Search stove ID, partner, state, branch or status..."}
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
                {showSoldCols ? (
                  <>
                    <TableHead>Sales Date</TableHead>
                    <TableHead>Sold By</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead>Status</TableHead>
                    <TableHead>Date Received</TableHead>
                  </>
                )}
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
                    {showSoldCols ? (
                      <>
                        <TableCell>{fmtDate(r.sales_date)}</TableCell>
                        <TableCell>
                          {r.seller_name}
                          {r.seller_role && (
                            <sup className="ml-0.5 text-[10px] text-gray-500 font-semibold">
                              {toSuperscript(ROLE_SHORT[r.seller_role] || r.seller_role.toUpperCase())}
                            </sup>
                          )}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="capitalize">{r.status || "—"}</TableCell>
                        <TableCell>{fmtDate(r.created_at)}</TableCell>
                      </>
                    )}
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
};

// ── Main Content ──────────────────────────────────────────────────────────────

export default function PartnersContent() {
  const { supabase, user } = useAuth();
  const { toast, toasts, removeToast } = useToast();
  const { can, isSuperAdmin } = usePermissions();

  // Row scoping (all partners vs. assigned partners) is enforced server-side
  // by manage-organizations / get-stove-stats — one shared fetch path per role.

  const ORG_CACHE_KEY = "partners_organizations_cache";
  const ORG_CACHE_TIMESTAMP_KEY = "partners_organizations_cache_timestamp";
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

  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [stoveIdsOrg, setStoveIdsOrg] = useState(null);
  const [stoveIdsFilter, setStoveIdsFilter] = useState("all");
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingOrganization, setEditingOrganization] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [organizationToDelete, setOrganizationToDelete] = useState(null);
  const [formSubmitLoading, setFormSubmitLoading] = useState(false);
  const [assignAgentOrg, setAssignAgentOrg] = useState(null);
  const [showOrgImportModal, setShowOrgImportModal] = useState(false);
  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false);
  const [credentialOrg, setCredentialOrg] = useState(null);
  const [viewingCredential, setViewingCredential] = useState(null);
  const [agentsModalOrg, setAgentsModalOrg] = useState(null);
  const [editingPartnerOrg, setEditingPartnerOrg] = useState(null);
  const [loadingCredentialOrgId, setLoadingCredentialOrgId] = useState(null);
  const [transferHistoryOrg, setTransferHistoryOrg] = useState(null);
  const [kpiModalMode, setKpiModalMode] = useState(null); // "purchased" | "sold" | "unsold" | null

  const [expandedOrgId, setExpandedOrgId] = useState(null);
  const [orgGroupedData, setOrgGroupedData] = useState({});
  const [loadingOrgId, setLoadingOrgId] = useState(null);
  const [expandedRefKeys, setExpandedRefKeys] = useState({});

  const [orgAgentsData, setOrgAgentsData] = useState({});
  const loadingAgentOrgIdsRef = useRef(new Set());

  const [sortMode, setSortMode] = useState("default");
  const [stoveSort, setStoveSort] = useState({ key: null, direction: null });
  const cycleStoveSort = (key) => {
    setStoveSort((prev) => {
      if (prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      if (prev.direction === "desc") return { key: null, direction: null };
      return { key, direction: "asc" };
    });
  };
  const stoveSortKeyMap = { received: "total_stove_ids", sold: "sold_stove_ids", available: "available_stove_ids" };
  const SortIcon = ({ col }) => {
    if (stoveSort.key !== col || !stoveSort.direction) return <ArrowUpDown className="w-3.5 h-3.5 opacity-70" />;
    return stoveSort.direction === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />;
  };
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState({ search: "", state: "all", partner_type: "all", assigned_agents: "all", branch: "" });
  const [stateSearch, setStateSearch] = useState("");
  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  const stateDropdownRef = useRef(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const branchDropdownRef = useRef(null);
  const [availableBranches, setAvailableBranches] = useState([]);
  const [typeCardFilter, setTypeCardFilter] = useState("all");

  const [stats, setStats] = useState({ total_received: 0, total_sold: 0, total_available: 0, total_partners: 0, performing_partners: 0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [typeCounts, setTypeCounts] = useState({ customer: 0, partner: 0 });
  const [loadingTypeCounts, setLoadingTypeCounts] = useState(false);

  const nigerianStates = Object.keys(lgaAndStates).sort();

  const {
    data: organizationsData,
    loading,
    tableLoading,
    error,
    pagination,
    applyFilters,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    fetchOrganizations,
  } = useOrganizations();

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(e.target)) setStateDropdownOpen(false);
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target)) setBranchDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch distinct branches when state or search changes
  useEffect(() => {
    const shouldShow = filters.state !== "all" || filters.search.trim().length > 0;
    if (!shouldShow) { setAvailableBranches([]); return; }
    const timer = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const params = new URLSearchParams({ limit: "200", offset: "0" });
        if (filters.state !== "all") params.set("state", filters.state);
        if (filters.search) params.set("search", filters.search);
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/manage-organizations?${params}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        const result = await res.json();
        const branches = [...new Set((result.data || []).map((o) => o.branch).filter(Boolean))].sort();
        setAvailableBranches(branches);
      } catch { setAvailableBranches([]); }
    }, 400);
    return () => clearTimeout(timer);
  }, [filters.state, filters.search]);

  const showBranchFilter = filters.state !== "all" || filters.search.trim().length > 0;

  const fetchStats = async (currentFilters = filters, currentDateFrom = dateFrom, currentDateTo = dateTo) => {
    setLoadingStats(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (currentDateFrom) params.set("dateFrom", currentDateFrom);
      if (currentDateTo) params.set("dateTo", currentDateTo);
      if (currentFilters.partner_type && currentFilters.partner_type !== "all") params.set("partner_type", currentFilters.partner_type);
      if (currentFilters.search) params.set("search", currentFilters.search);
      if (currentFilters.state && currentFilters.state !== "all") params.set("state", currentFilters.state);
      const qs = params.toString();
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-stove-stats${qs ? "?" + qs : ""}`,
        { headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setStats({ total_received: result.data?.total || 0, total_sold: result.data?.sold || 0, total_available: result.data?.available || 0, total_partners: pagination.total || 0, performing_partners: result.data?.performing_partners || 0 });
    } catch (err) { console.error("Stats error:", err); }
    finally { setLoadingStats(false); }
  };

  useEffect(() => { if (!loading) fetchStats(filters, dateFrom, dateTo); }, [organizationsData, pagination.total, dateFrom, dateTo]);

  const fetchTypeCounts = async () => {
    setLoadingTypeCounts(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const base = `${SUPABASE_URL}/functions/v1/manage-organizations`;
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [custRes, partRes] = await Promise.all([
        fetch(`${base}?partner_type=customer&limit=1&offset=0&include_admin_users=false`, { headers }),
        fetch(`${base}?partner_type=partner&limit=1&offset=0&include_admin_users=false`, { headers }),
      ]);
      const [custData, partData] = await Promise.all([custRes.json(), partRes.json()]);
      setTypeCounts({ customer: custData.pagination?.total ?? 0, partner: partData.pagination?.total ?? 0 });
    } catch (err) { console.error("Type counts error:", err); }
    finally { setLoadingTypeCounts(false); }
  };

  useEffect(() => { fetchTypeCounts(); }, []);

  const STOVE_SORT_MAP = {
    active: "sold_stove_ids",
    stoves_desc: "total_stove_ids",
    available_desc: "available_stove_ids",
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      const stoveSortBy = STOVE_SORT_MAP[sortMode];
      applyFilters({
        page: 1,
        search: filters.search || null,
        state: filters.state !== "all" ? filters.state : null,
        partner_type: filters.partner_type !== "all" ? filters.partner_type : null,
        branch: filters.branch || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        sortBy: stoveSortBy || null,
        sortOrder: stoveSortBy ? "desc" : null,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [filters, dateFrom, dateTo, sortMode]);

  const handleFilterChange = (field, value) => setFilters((prev) => ({ ...prev, [field]: value }));
  const handleTypeCardClick = (type) => {
    const next = typeCardFilter === type ? "all" : type;
    setTypeCardFilter(next);
    setFilters((prev) => ({ ...prev, partner_type: next }));
  };
  const handleClearFilters = () => {
    setFilters({ search: "", state: "all", partner_type: "all", assigned_agents: "all", branch: "" });
    setTypeCardFilter("all");
    setSortMode("default");
    setDateFrom("");
    setDateTo("");
    setStateSearch("");
    setBranchSearch("");
    setAvailableBranches([]);
  };
  const hasActiveFilters = filters.search || filters.state !== "all" || filters.partner_type !== "all" || filters.assigned_agents !== "all" || filters.branch || dateFrom || dateTo;

  const handlePageChange = (page) => applyFilters({ page });
  const handlePageSizeChange = (value) => applyFilters({ page: 1, limit: parseInt(value) });

  const getVisiblePages = () => {
    const pages = [];
    let start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleToggleStoveBreakdown = async (org) => {
    if (expandedOrgId === org.id) { setExpandedOrgId(null); return; }
    setExpandedOrgId(org.id);
    if (orgGroupedData[org.id]) return;
    setLoadingOrgId(org.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({ grouped: "true", organization_ids: org.id });
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/manage-stove-ids?${params}`,
        { headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
      );
      const result = await res.json();
      setOrgGroupedData((prev) => ({ ...prev, [org.id]: result.data || [] }));
    } catch {
      setOrgGroupedData((prev) => ({ ...prev, [org.id]: [] }));
    } finally { setLoadingOrgId(null); }
  };

  const handleToggleRef = (orgId, refKey) => {
    const key = `${orgId}::${refKey}`;
    setExpandedRefKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (organizationsData.length === 0) return;
    organizationsData.forEach((org) => {
      if (orgAgentsData[org.id] !== undefined) return;
      if (loadingAgentOrgIdsRef.current.has(org.id)) return;
      loadingAgentOrgIdsRef.current.add(org.id);
      superAdminAgentService.getAgentsByOrganization(org.id)
        .then((response) => {
          setOrgAgentsData((prev) => ({ ...prev, [org.id]: response.data || [] }));
        })
        .catch(() => {
          setOrgAgentsData((prev) => ({ ...prev, [org.id]: [] }));
        })
        .finally(() => {
          loadingAgentOrgIdsRef.current.delete(org.id);
        });
    });
  }, [organizationsData]);

  const formatDate = (d) => {
    if (!d) return "N/A";
    try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return "N/A"; }
  };

  const handleViewDetails = (org) => setSelectedOrganization(org);
  const handleViewStoveIds = (org, filter = "all") => { setStoveIdsOrg(org); setStoveIdsFilter(filter); };
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
  const handleEdit = (org) => { setEditingOrganization(org); setShowFormModal(true); };
  const handleDelete = (org) => { setOrganizationToDelete(org); setShowDeleteModal(true); };

  const handleFormSubmit = async (formData) => {
    setFormSubmitLoading(true);
    try {
      if (editingOrganization) {
        const res = await updateOrganization(editingOrganization.id, formData);
        if (res.success) { toast({ variant: "success", title: "Organization updated successfully" }); setShowFormModal(false); setEditingOrganization(null); }
      } else {
        const res = await createOrganization(formData);
        if (res.success) { toast({ variant: "success", title: "Organization created successfully" }); setShowFormModal(false); }
      }
    } catch (err) { console.error(err); }
    finally { setFormSubmitLoading(false); }
  };

  const handleDeleteConfirm = async () => {
    try {
      const res = await deleteOrganization(organizationToDelete.id);
      if (res.success) {
        toast({ variant: "success", title: "Organization deleted successfully" });
        setShowDeleteModal(false);
        setOrganizationToDelete(null);
      }
    } catch (err) {
      toast({ variant: "error", title: "Error", description: err.message || "Failed to delete" });
    }
  };

  const filteredOrgs = organizationsData.filter((o) => {
    if (filters.assigned_agents === "assigned") return orgAgentsData[o.id] !== undefined && orgAgentsData[o.id].length > 0;
    if (filters.assigned_agents === "unassigned") return orgAgentsData[o.id] !== undefined && orgAgentsData[o.id].length === 0;
    return true;
  });

  const sortedOrgs = [...filteredOrgs].sort((a, b) => {
    if (sortMode === "active") return (b.sold_stove_ids ?? 0) - (a.sold_stove_ids ?? 0);
    if (sortMode === "stoves_desc") return (b.total_stove_ids ?? 0) - (a.total_stove_ids ?? 0);
    if (sortMode === "available_desc") return (b.available_stove_ids ?? 0) - (a.available_stove_ids ?? 0);
    return 0;
  });

  const displayedOrgs = (() => {
    if (!stoveSort.key || !stoveSort.direction) return sortedOrgs;
    const field = stoveSortKeyMap[stoveSort.key];
    const dir = stoveSort.direction === "asc" ? 1 : -1;
    return [...sortedOrgs].sort((a, b) => (((a[field] ?? 0) - (b[field] ?? 0)) * dir));
  })();

  const startRecord = organizationsData.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const endRecord = Math.min(pagination.page * pagination.limit, pagination.total);

  if (loading) return (
    <DashboardLayout currentRoute="partners" title="Track Performance">
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin h-8 w-8 text-brand" />
      </div>
    </DashboardLayout>
  );

  if (error && !error.includes("login")) return (
    <DashboardLayout currentRoute="partners" title="Track Performance">
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">
          Error: {error}
          <Button onClick={fetchOrganizations} size="sm" variant="outline" className="ml-3">Retry</Button>
        </div>
      </div>
    </DashboardLayout>
  );

  return (
    <>
      <DashboardLayout currentRoute="partners" title="Track Performance">
        <div className="p-6 space-y-5">

          <PageHeader
            icon={Building2}
            title="Track Performance"
          />


          <div className="p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3" style={{ backgroundColor: "#f4f7e3" }}>
            {/* Search */}
            <div className="w-1/4 min-w-[180px] relative">
              <Input placeholder="Search by name, ID, branch..." value={filters.search} onChange={(e) => handleFilterChange("search", e.target.value)} className="bg-white h-9 text-sm shadow-none" />
            </div>

            {/* Searchable State Filter */}
            <div className="relative w-[155px]" ref={stateDropdownRef}>
              <button
                onClick={() => setStateDropdownOpen((o) => !o)}
                className="w-full h-9 px-3 flex items-center justify-between bg-white border border-input rounded-md text-sm text-left focus:outline-none focus:ring-2 focus:ring-ring shadow-none"
              >
                <span className={filters.state === "all" ? "text-muted-foreground" : ""}>
                  {filters.state === "all" ? "All States" : nigerianStates.find((s) => s.toLowerCase() === filters.state) || filters.state}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
              {stateDropdownOpen && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg">
                  <div className="p-1.5 border-b border-gray-100">
                    <Input
                      autoFocus
                      placeholder="Type to search..."
                      value={stateSearch}
                      onChange={(e) => setStateSearch(e.target.value)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <button
                      onClick={() => { handleFilterChange("state", "all"); setStateSearch(""); setStateDropdownOpen(false); handleFilterChange("branch", ""); setBranchSearch(""); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${filters.state === "all" ? "font-semibold text-brand" : ""}`}
                    >All States</button>
                    {nigerianStates.filter((s) => s.toLowerCase().includes(stateSearch.toLowerCase())).map((s) => (
                      <button
                        key={s}
                        onClick={() => { handleFilterChange("state", s.toLowerCase()); setStateSearch(""); setStateDropdownOpen(false); handleFilterChange("branch", ""); setBranchSearch(""); }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${filters.state === s.toLowerCase() ? "font-semibold text-brand" : ""}`}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Branch Filter — only when state selected or partner name typed */}
            {showBranchFilter && (
              <div className="relative w-[155px]" ref={branchDropdownRef}>
                <button
                  onClick={() => setBranchDropdownOpen((o) => !o)}
                  className="w-full h-9 px-3 flex items-center justify-between bg-white border border-input rounded-md text-sm text-left focus:outline-none focus:ring-2 focus:ring-ring shadow-none"
                >
                  <span className={!filters.branch ? "text-muted-foreground" : ""}>
                    {filters.branch || "All Branches"}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
                {branchDropdownOpen && (
                  <div className="absolute z-50 top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg">
                    <div className="p-1.5 border-b border-gray-100">
                      <Input
                        autoFocus
                        placeholder="Type to search..."
                        value={branchSearch}
                        onChange={(e) => setBranchSearch(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        onClick={() => { handleFilterChange("branch", ""); setBranchSearch(""); setBranchDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${!filters.branch ? "font-semibold text-brand" : ""}`}
                      >All Branches</button>
                      {availableBranches.filter((b) => b.toLowerCase().includes(branchSearch.toLowerCase())).map((b) => (
                        <button
                          key={b}
                          onClick={() => { handleFilterChange("branch", b); setBranchSearch(""); setBranchDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${filters.branch === b ? "font-semibold text-brand" : ""}`}
                        >{b}</button>
                      ))}
                      {availableBranches.filter((b) => b.toLowerCase().includes(branchSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-muted-foreground px-3 py-2">No branches found</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}


            {/* Date Range Filter */}
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
                      className="h-9 px-3 flex items-center gap-1.5 rounded-md text-sm bg-white border border-input text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-ring shadow-none"
                    >
                      <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
                      <span className={!fromDate ? "text-muted-foreground" : ""}>{label}</span>
                      {fromDate && (
                        <X
                          className="h-3.5 w-3.5 text-gray-400 hover:text-gray-700 ml-1"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDateFrom("");
                            setDateTo("");
                          }}
                        />
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="range"
                      selected={{ from: fromDate, to: toDate }}
                      onSelect={(range) => {
                        setDateFrom(range?.from ? format(range.from, "yyyy-MM-dd") : "");
                        setDateTo(range?.to ? format(range.to, "yyyy-MM-dd") : "");
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

            {hasActiveFilters && (
              <Button onClick={handleClearFilters} size="sm" variant="outline" className="h-9 shadow-none">
                <X className="h-4 w-4 mr-1" />Clear
              </Button>
            )}
          </div>


          {/* KPI Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                gradient: "from-[#194977] to-[#2563EB]",
                Icon: Building2,
                value: loadingStats ? "—" : (stats.total_partners || pagination.total).toLocaleString(),
                label: "Total Partners",
                sub: "All registered partners",
                onClick: () => { setSortMode("default"); handleFilterChange("partner_type", "all"); },
                active: sortMode === "default" && filters.partner_type === "all",
              },
              {
                gradient: "from-[#B45309] to-[#F59E0B]",
                Icon: Package,
                value: loadingStats ? "—" : stats.total_received.toLocaleString(),
                label: "Stoves Purchased from ACSL",
                onClick: () => setKpiModalMode("purchased"),
                active: false,
              },
              {
                gradient: "from-[#047857] to-[#10B981]",
                Icon: TrendingUp,
                value: loadingStats ? "—" : stats.total_sold.toLocaleString(),
                label: "Total Stoves Sold",
                onClick: () => setKpiModalMode("sold"),
                active: false,
              },
              {
                gradient: "from-[#7C3AED] to-[#A78BFA]",
                Icon: Boxes,
                value: loadingStats ? "—" : stats.total_available.toLocaleString(),
                label: "Total Unsold Stoves",
                onClick: () => setKpiModalMode("unsold"),
                active: false,
              },
            ].map(({ gradient, Icon, value, label, sub, subBadge, onClick }) => (
              <button
                type="button"
                key={label}
                onClick={onClick}
                className={`relative overflow-hidden rounded-lg border-transparent px-4 py-4 shadow-md transition-all bg-gradient-to-br ${gradient} text-left hover:brightness-110 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/60 cursor-pointer`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-2xl font-bold text-white tracking-tight leading-tight">{value}</p>
                    <p className="text-sm font-semibold text-white/90 mt-1">{label}</p>
                    <p className="text-xs text-white/60 mt-0.5">{sub}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="rounded-lg p-2 bg-white/20 text-white shadow-sm w-fit">
                      <Icon className="h-4 w-4" />
                    </div>
                    {subBadge && (
                      <span className="text-[10px] bg-white/20 text-white/90 px-1.5 py-0.5 rounded whitespace-nowrap">
                        {subBadge}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}

          </div>

          {/* Monthly Sales Chart */}
          <MonthlySalesChart />

          {/* Sales by State + Sales by Models row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SalesByStateChart />
            <SalesByModelsChart />
          </div>

          <div className="space-y-0">
            <div className="flex items-center justify-between px-1 py-2">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">{startRecord}–{endRecord}</span> of <span className="font-medium">{pagination.total}</span> partners
              </p>
              <Button
                size="sm"
                className="h-8 px-3 text-xs flex items-center gap-1 bg-black hover:bg-black/90 text-white shadow-none rounded-md"
                onClick={() => {
                  const headers = ["Partner Name", "Type", "Branch", "State", "Contact Person", "Contact Phone", "Email", "Total Stoves", "Sold", "Available"];
                  const rows = organizationsData.map((org) => [org.partner_name, org.partner_type || "", org.branch || "", org.state || "", org.contact_person || "", org.contact_phone || "", org.email || "", org.total_stove_ids ?? "", org.sold_stove_ids ?? "", org.available_stove_ids ?? ""]);
                  downloadTableAsCSV(headers, rows, `partners-${new Date().toISOString().slice(0, 10)}.csv`);
                }}
                disabled={organizationsData.length === 0}
              >
                <Download className="h-3.5 w-3.5 mr-1" />Download
              </Button>
            </div>

            <div className="bg-white border border-gray-200 overflow-x-auto relative rounded-t-lg">

              {tableLoading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <Loader2 className="h-6 w-6 animate-spin text-brand" />
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow style={{ backgroundColor: "#4a5d0f" }} className="hover:bg-transparent">
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Partner</TableHead>
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap">State</TableHead>
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Branch</TableHead>
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Phone Number</TableHead>
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                      <button type="button" onClick={() => cycleStoveSort("received")} className="inline-flex items-center gap-1 mx-auto hover:opacity-90" title="Sort by Purchased">
                        Purchased <SortIcon col="received" />
                      </button>
                    </TableHead>
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                      <button type="button" onClick={() => cycleStoveSort("sold")} className="inline-flex items-center gap-1 mx-auto hover:opacity-90" title="Sort by Sold">
                        Sold <SortIcon col="sold" />
                      </button>
                    </TableHead>
                    <TableHead className="text-white font-semibold text-sm whitespace-nowrap text-center">
                      <button type="button" onClick={() => cycleStoveSort("available")} className="inline-flex items-center gap-1 mx-auto hover:opacity-90" title="Sort by Available">
                        Available <SortIcon col="available" />
                      </button>
                    </TableHead>
                    
                    <TableHead className="text-right text-white font-semibold text-sm whitespace-nowrap"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={tableLoading ? "opacity-40" : ""}>
                  {sortedOrgs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10">
                        <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500 font-medium">No partners found</p>
                        <p className="text-gray-400 text-sm">Try adjusting your filters</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayedOrgs.map((org, idx) => (
                      <React.Fragment key={org.id}>
                        <TableRow className="hover:bg-[#eef3c4] text-gray-700" style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f4f7e3" }}>
                          <TableCell className="text-sm font-medium text-gray-900">{org.partner_name}</TableCell>
                          <TableCell className="text-sm">{org.state || "N/A"}</TableCell>
                          <TableCell className="text-sm">{org.branch || "N/A"}</TableCell>
                          <TableCell className="text-sm">{org.contact_phone || "—"}</TableCell>
                          <TableCell className="text-center">
                            <button onClick={() => handleViewStoveIds(org, "all")} className="inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors" title="Total received">
                              {org.total_stove_ids ?? 0}
                            </button>
                          </TableCell>
                          <TableCell className="text-center">
                            <button onClick={() => handleViewStoveIds(org, "sold")} className="inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors" title="Sold">
                              {org.sold_stove_ids ?? 0}
                            </button>
                          </TableCell>
                          <TableCell className="text-center">
                            <button onClick={() => handleViewStoveIds(org, "available")} className="inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 transition-colors" title="Available">
                              {org.available_stove_ids ?? 0}
                            </button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {can("manage-all-partners") && (

                                <Button size="sm" className="h-7 px-2 text-xs rounded-none bg-black hover:bg-black/90 text-white" title="Purchases from ACSL" onClick={() => setTransferHistoryOrg(org)}>
                                  Purchases from ACSL
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {expandedOrgId === org.id && (
                          <TableRow key={`${org.id}-breakdown`} className="bg-blue-50/40">
                            <TableCell colSpan={8} className="p-0">
                              <div className="px-4 py-3">
                                {loadingOrgId === org.id ? (
                                  <div className="flex items-center gap-2 py-3 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading stove reference breakdown...</div>
                                ) : !orgGroupedData[org.id] || orgGroupedData[org.id].length === 0 ? (
                                  <p className="text-xs text-gray-500 py-2 italic">No stove IDs assigned to this partner yet.</p>
                                ) : (
                                  <div className="border border-gray-200 rounded-md overflow-hidden">
                                    <div className="bg-[#07376a] px-3 py-2 flex items-center gap-2">
                                      <Tag className="h-3.5 w-3.5 text-white/80" />
                                      <span className="text-xs font-semibold text-white">Sales Reference Breakdown</span>
                                    </div>
                                    {orgGroupedData[org.id].map((group) => {
                                      const refKey = group.sales_reference || "__none__";
                                      const compositeKey = `${org.id}::${refKey}`;
                                      const isRefExpanded = !!expandedRefKeys[compositeKey];
                                      return (
                                        <div key={refKey} className="border-b border-gray-100 last:border-b-0">
                                          <button onClick={() => handleToggleRef(org.id, refKey)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors text-left">
                                            <div className="flex items-center gap-2">
                                              {isRefExpanded ? <ChevronUp className="h-3.5 w-3.5 text-[#07376a]" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                                              <span className="text-xs font-semibold text-[#07376a]">{group.sales_reference || <span className="italic text-gray-400 font-normal">No Reference</span>}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="bg-purple-100 text-purple-800 text-[10px] px-2 py-0.5 rounded-full font-medium">{group.total} received</span>
                                              <span className="bg-green-100 text-green-800 text-[10px] px-2 py-0.5 rounded-full font-medium">{group.available} available</span>
                                              <span className="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded-full font-medium">{group.sold} sold</span>
                                            </div>
                                          </button>
                                          {isRefExpanded && (
                                            <div className="bg-white border-t border-gray-100">
                                              <table className="w-full text-xs">
                                                <thead>
                                                  <tr className="bg-gray-50 text-gray-600 border-b border-gray-100">
                                                    <th className="text-left px-3 py-2 font-semibold">Stove ID</th>
                                                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                                                    <th className="text-left px-3 py-2 font-semibold">Assigned Date</th>
                                                    <th className="text-left px-3 py-2 font-semibold">Date Sold</th>
                                                    <th className="text-left px-3 py-2 font-semibold">Sold To</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {(group.stove_ids || []).map((stove, si) => (
                                                    <tr key={stove.id} className={si % 2 === 0 ? "bg-white" : "bg-blue-50/30"}>
                                                      <td className="px-3 py-2 font-mono font-medium text-gray-900">{stove.stove_id}</td>
                                                      <td className="px-3 py-2">
                                                        <span className={`px-2 py-0.5 rounded-full font-medium ${stove.status === "sold" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>{stove.status === "sold" ? "Sold" : "Available"}</span>
                                                      </td>
                                                      <td className="px-3 py-2 text-gray-500">{formatDate(stove.created_at)}</td>
                                                      <td className="px-3 py-2 text-gray-500">{stove.sale_date ? formatDate(stove.sale_date) : "—"}</td>
                                                      <td className="px-3 py-2 text-gray-500">{stove.sold_to || "—"}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600">Showing {startRecord} to {endRecord} of {pagination.total} partners</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-500">per page:</span>
                  <Select value={pagination.limit?.toString() ?? "10"} onValueChange={handlePageSizeChange}>
                    <SelectTrigger className="w-[70px] h-8 bg-white text-sm shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {pagination.totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => handlePageChange(1)} disabled={pagination.page === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page === 1}><ChevronLeft className="h-4 w-4 mr-1" />Prev</Button>
                  {getVisiblePages().map((p) => (
                    <Button key={p} variant={p === pagination.page ? "default" : "outline"} size="sm" className={`h-8 w-8 p-0 ${p === pagination.page ? "bg-black text-white hover:bg-black" : ""}`} onClick={() => handlePageChange(p)}>{p}</Button>
                  ))}
                  <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => handlePageChange(pagination.totalPages)} disabled={pagination.page >= pagination.totalPages}><ChevronsRight className="h-4 w-4" /></Button>
                </div>
              )}
            </div>

          </div>
        </div>

        <AddPartnerModal isOpen={showAddPartnerModal} onClose={() => setShowAddPartnerModal(false)} onSuccess={() => { fetchOrganizations(); fetchTypeCounts(); }} />
        <EditPartnerModal
          organization={editingPartnerOrg}
          isOpen={!!editingPartnerOrg}
          onClose={() => setEditingPartnerOrg(null)}
          onSuccess={(updatedOrg) => {
            setEditingPartnerOrg(null);
            fetchOrganizations();
          }}
        />
        <OrganizationFormModal isOpen={showFormModal} onClose={() => { setShowFormModal(false); setEditingOrganization(null); setFormSubmitLoading(false); }} onSubmit={handleFormSubmit} initialData={editingOrganization} loading={loading} submitLoading={formSubmitLoading} />
        <PartnerDetailModal organization={selectedOrganization} isOpen={!!selectedOrganization} onClose={() => setSelectedOrganization(null)} onEdit={handleEdit} />
        <StoveIdsModal organization={stoveIdsOrg} isOpen={!!stoveIdsOrg} onClose={() => setStoveIdsOrg(null)} initialFilter={stoveIdsFilter} />
        <DeleteConfirmationModal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setOrganizationToDelete(null); }} onConfirm={handleDeleteConfirm} organizationName={organizationToDelete?.partner_name} loading={loading} />
        <OrganizationCSVImportModal isOpen={showOrgImportModal} onClose={() => setShowOrgImportModal(false)} onImportComplete={() => fetchOrganizations()} supabase={supabase} />
        <AssignAgentModal
          organization={assignAgentOrg}
          isOpen={!!assignAgentOrg}
          onClose={() => setAssignAgentOrg(null)}
          onSuccess={() => { setAssignAgentOrg(null); setOrgAgentsData({}); }}
        />
        <ViewCredentialModal isOpen={!!viewingCredential} onClose={() => setViewingCredential(null)} credential={viewingCredential} />
        <AssignedAgentsModal organization={agentsModalOrg} agents={agentsModalOrg ? (orgAgentsData[agentsModalOrg.id] || []) : []} isOpen={!!agentsModalOrg} onClose={() => setAgentsModalOrg(null)} />
        <StoveTransferHistoryModal organization={transferHistoryOrg} isOpen={!!transferHistoryOrg} onClose={() => setTransferHistoryOrg(null)} />
        <SystemStovesModal isOpen={!!kpiModalMode} mode={kpiModalMode} onClose={() => setKpiModalMode(null)} />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </DashboardLayout>
    </>
  );
}

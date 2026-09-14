import { useState, useEffect, useMemo, useCallback } from "react";
import { useToastNotification } from "@/app/contexts/useToastNotification";
import DashboardLayout from "../components/DashboardLayout";
import PageHeader from "../components/PageHeader";
import { Users, Eye, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Download,
  Loader2,
  Trash2,
} from "lucide-react";
import salesAdvancedService from "../services/salesAdvancedAPIService";
import adminSalesService from "../services/adminSalesService";
import { lgaAndStates } from "../constants";
import AdminSalesDetailModal from "../admin/components/sales/AdminSalesDetailModal";
import EditEndUserModal from "./EditEndUserModal";
import CancelSaleModal from "../admin/components/sales/CancelSaleModal";
import { useAuth } from "../contexts/useAuth";
import { resolveRole } from "@/lib/permissions";
import { formatDate as formatDateShared } from "@/app/utils/formatDate";
import { fieldLabel } from "@/lib/saleDictionary";

const formatDate = (v) => formatDateShared(v, { style: "numeric" });

const EndUserRecordsContent = () => {
  // sonner's <Toaster /> is mounted nowhere in this app, so its toasts were
  // silent. The app's own provider is.
  const { toast } = useToastNotification();
  const [allSales, setAllSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedState, setSelectedState] = useState("all");
  const [selectedLGA, setSelectedLGA] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortOrder, setSortOrder] = useState("desc");
  const [selectedSale, setSelectedSale] = useState(null);
  const [editSale, setEditSale] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { userRole } = useAuth();
  const resolvedRole = resolveRole(userRole) || "";
  const canEdit = ["super_admin", "acsl_agent_manager", "partner"].includes(
    resolvedRole
  );
  const canDelete = ["super_admin", "partner"].includes(resolvedRole);

  const stateList = useMemo(() => Object.keys(lgaAndStates).sort(), []);
  const lgaList = useMemo(
    () =>
      selectedState !== "all"
        ? (lgaAndStates[selectedState] || [])
        : [],
    [selectedState]
  );

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      // The edge function caps limit at 500, so page through until all
      // role-scoped records are loaded (server enforces row scoping per role).
      const PAGE_LIMIT = 500;
      const MAX_PAGES = 40;
      let page = 1;
      let records = [];
      let totalPages = 1;
      do {
        const result = await salesAdvancedService.getSalesData(
          { page, limit: PAGE_LIMIT, responseFormat: "format2" },
          "POST",
          "EndUserRecords"
        );
        if (!result.success) {
          setError(result.error || "Failed to fetch data");
          return;
        }
        records = records.concat(result.data || []);
        totalPages = result.pagination?.totalPages || 1;
        page += 1;
      } while (page <= totalPages && page <= MAX_PAGES);
      setAllSales(records);
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const filteredSales = useMemo(() => {
    let result = [...allSales];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (s) =>
          (s.end_user_name || "").toLowerCase().includes(term) ||
          (s.contact_person || "").toLowerCase().includes(term) ||
          (s.phone || "").toLowerCase().includes(term) ||
          (s.stove_serial_no || "").toLowerCase().includes(term) ||
          (s.partner_name || "").toLowerCase().includes(term) ||
          (s.transaction_id || "").toLowerCase().includes(term)
      );
    }

    if (selectedState !== "all") {
      result = result.filter(
        (s) =>
          (s.state_backup || "").toLowerCase() === selectedState.toLowerCase()
      );
    }
    if (selectedLGA !== "all") {
      result = result.filter(
        (s) =>
          (s.lga_backup || "").toLowerCase() === selectedLGA.toLowerCase()
      );
    }
    if (startDate) {
      result = result.filter(
        (s) => (s.sales_date || s.created_at) >= startDate
      );
    }
    if (endDate) {
      result = result.filter(
        (s) => (s.sales_date || s.created_at) <= endDate + "T23:59:59"
      );
    }

    result.sort((a, b) => {
      const dA = new Date(a.sales_date || a.created_at).getTime();
      const dB = new Date(b.sales_date || b.created_at).getTime();
      return sortOrder === "asc" ? dA - dB : dB - dA;
    });

    return result;
  }, [
    allSales,
    searchTerm,
    selectedState,
    selectedLGA,
    startDate,
    endDate,
    sortOrder,
  ]);

  const totalRecords = filteredSales.length;
  const totalPages = Math.ceil(totalRecords / pageSize);
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);

  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedState, selectedLGA, startDate, endDate, pageSize]);

  const hasActiveFilters =
    searchTerm !== "" ||
    selectedState !== "all" ||
    selectedLGA !== "all" ||
    startDate !== "" ||
    endDate !== "";

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedState("all");
    setSelectedLGA("all");
    setStartDate("");
    setEndDate("");
  };

  const getVisiblePages = () => {
    const pages = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const getModifierName = (s) =>
    s.updated_by_profile?.full_name ||
    s.creator?.full_name ||
    s.created_by_profile?.full_name ||
    s.sales_agent?.full_name ||
    "";

  const formatModifier = (s) => {
    const name = getModifierName(s);
    const when = s.updated_at || s.created_at ? formatDate(s.updated_at || s.created_at) : null;
    if (!name && !when) return "—";
    if (name && when) return `${name} · ${when}`;
    return name || when || "—";
  };

  const handleExport = () => {
    const headers = [
      fieldLabel("sales_date"),
      fieldLabel("end_user_name"),
      fieldLabel("state_backup"),
      fieldLabel("lga_backup"),
      fieldLabel("contact_person"),
      fieldLabel("phone"),
      fieldLabel("partner_name"),
      fieldLabel("stove_serial_no"),
      "Last Modified By",
    ];
    const rows = filteredSales.map((s) => [
      formatDate(s.sales_date || s.created_at),
      s.end_user_name || "",
      s.state_backup || "",
      s.lga_backup || "",
      s.contact_person || "",
      s.phone || s.contact_phone || "",
      s.partner_name || s.organizations?.name || s.organizations?.partner_name || "",
      s.stove_serial_no || "",
      formatModifier(s),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `end-user-records-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout
      currentRoute="end-user-records"
      title="End User Records"
      description="View and manage end user records"
    >
      <TooltipProvider>
      <div className="p-6 space-y-4">
        <PageHeader
          icon={Users}
          title="End User Records"
          right={
            <Button
              size="sm"
              className="bg-black hover:bg-gray-800 text-white flex items-center gap-1.5 rounded-none"
              onClick={handleExport}
              disabled={filteredSales.length === 0}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          }
        />

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="bg-[#FAFCFD] p-4 rounded-lg border border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative md:w-[320px] w-full">
              <Input
                type="text"
                placeholder="Search by name, phone, stove ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white text-sm h-9 shadow-none"
              />
            </div>

            <div className="flex-1 min-w-[140px] max-w-[180px]">
              <Select value={selectedState} onValueChange={(v) => { setSelectedState(v); setSelectedLGA("all"); }}>
                <SelectTrigger className="bg-white text-sm h-9 shadow-none">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {stateList.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedState !== "all" && lgaList.length > 0 && (
              <div className="flex-1 min-w-[140px] max-w-[180px]">
                <Select value={selectedLGA} onValueChange={setSelectedLGA}>
                  <SelectTrigger className="bg-white text-sm h-9 shadow-none">
                    <SelectValue placeholder="All LGAs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All LGAs</SelectItem>
                    {lgaList.map((lga) => (
                      <SelectItem key={lga} value={lga}>{lga}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white w-[140px] h-9 text-sm shadow-none"
              />
              <span className="text-gray-400 text-sm">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-white w-[140px] h-9 text-sm shadow-none"
              />
            </div>

            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="flex items-center gap-1 h-9 px-3 rounded-none shadow-none"
              >
                <X className="h-3 w-3" />
                Reset Filters
              </Button>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-500">Loading end user records...</span>
          </div>
        ) : (
          <>
            {/* Top pagination bar */}
            <div className="px-4 py-2 flex items-center justify-end">
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
                  <span className="font-medium">{totalRecords}</span> records
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">per page:</span>
                  <Select value={pageSize.toString()} onValueChange={(val) => setPageSize(Number(val))}>
                    <SelectTrigger className="w-[65px] h-7 bg-white text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white border-x border-gray-200 overflow-x-auto">
              <Table className="text-sm">
                <TableHeader className="bg-[#4a5d0f]">
                  <TableRow className="hover:bg-[#4a5d0f]">
                    <TableHead
                      className="text-white font-semibold py-2 px-2 whitespace-nowrap cursor-pointer select-none"
                      onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                    >
                      <div className="flex items-center gap-1">
                        {fieldLabel("sales_date")}
                      </div>
                    </TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2">{fieldLabel("end_user_name")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2">{fieldLabel("state_backup")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2">{fieldLabel("lga_backup")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2">{fieldLabel("contact_person")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">{fieldLabel("phone")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2">{fieldLabel("partner_name")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">{fieldLabel("stove_serial_no")}</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2">Last Modified By</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                        {searchTerm || hasActiveFilters
                          ? "No records found matching your filters."
                          : "No end user records available."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSales.map((sale, idx) => (
                      <TableRow
                        key={sale.id}
                        className="bg-white hover:bg-gray-50"
                      >
                        <TableCell className="py-2 px-2 whitespace-nowrap align-top">
                          {formatDate(sale.sales_date || sale.created_at)}
                        </TableCell>
                        <TableCell className="py-2 px-2 break-words align-top max-w-[160px]">
                          {sale.end_user_name || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 break-words align-top max-w-[110px]">
                          {sale.state_backup || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 break-words align-top max-w-[120px]">
                          {sale.lga_backup || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 break-words align-top max-w-[160px]">
                          {sale.contact_person || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap align-top">
                          {sale.phone || sale.contact_phone || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 break-words align-top max-w-[180px]">
                          {sale.partner_name || sale.organizations?.name || sale.organizations?.partner_name || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap align-top">
                          {sale.stove_serial_no || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 align-top text-xs max-w-[160px] break-words">
                          {(() => {
                            const name = getModifierName(sale);
                            const when = sale.updated_at || sale.created_at;
                            if (!name && !when) return <span className="text-gray-400">—</span>;
                            return (
                              <div className="flex flex-col leading-tight">
                                {name && <span className="font-medium">{name}</span>}
                                {when && <span className="text-gray-500">{formatDate(when)}</span>}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  aria-label="View details"
                                  className="h-8 w-8 rounded-none border-[#4a5d0f] text-[#4a5d0f] hover:bg-[#eef3c4]"
                                  onClick={() => setSelectedSale(sale)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">View details</TooltipContent>
                            </Tooltip>
                            {canEdit && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    aria-label="Edit record"
                                    className="h-8 w-8 rounded-none bg-[#4a5d0f] hover:bg-[#3a4a0c] text-white"
                                    onClick={() => setEditSale(sale)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Edit record</TooltipContent>
                              </Tooltip>
                            )}
                            {canDelete && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    aria-label="Delete record"
                                    className="h-8 w-8 rounded-none bg-red-600 hover:bg-red-700 text-white"
                                    onClick={() => setDeleteTarget(sale)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Delete record</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Bottom pagination */}
            {totalPages > 1 && (
              <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
                <p className="text-sm text-gray-600">
                  Showing {startRecord} to {endRecord} of {totalRecords} records
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-none"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 rounded-none"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />Prev
                  </Button>
                  {getVisiblePages().map((p) => (
                    <Button
                      key={p}
                      variant={p === currentPage ? "default" : "outline"}
                      size="sm"
                      className={`h-8 w-8 p-0 rounded-none ${
                        p === currentPage ? "bg-black text-white hover:bg-black" : ""
                      }`}
                      onClick={() => setCurrentPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 rounded-none"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next<ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-none"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <AdminSalesDetailModal
        open={!!selectedSale}
        onClose={() => setSelectedSale(null)}
        sale={selectedSale}
        viewFrom="superAdmin"
      />
      <EditEndUserModal
        open={!!editSale}
        sale={editSale}
        onClose={() => setEditSale(null)}
        onSaved={(updated) => {
          setAllSales((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
          // Refresh in the background to pick up the fresh updated_by_profile join.
          fetchSales();
        }}
      />
      <CancelSaleModal
        open={!!deleteTarget}
        sale={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={
          <div className="flex items-center gap-2 text-red-700">
            <Trash2 className="h-5 w-5" />
            Delete End User Record
          </div>
        }
        confirmLabel="Confirm Delete"
        requireReason
        onConfirm={async (reason) => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          try {
            const result = await adminSalesService.cancelSale(target.id, reason);
            if (result && result.success === false) {
              const msg = result.error || result.message || "Failed to delete record";
              setError(msg);
              toast.error(msg);
              return;
            }
            setAllSales((prev) => prev.filter((s) => s.id !== target.id));
            setDeleteTarget(null);
            fetchSales();
            toast.success(
              `End user record for ${target.end_user_name || target.phone || "the selected customer"} has been deleted.`
            );
          } catch (e) {
            const msg = e?.message || "Failed to delete record";
            setError(msg);
            toast.error(msg);
          }
        }}
      />
      </TooltipProvider>
    </DashboardLayout>
  );
};

export default EndUserRecordsContent;

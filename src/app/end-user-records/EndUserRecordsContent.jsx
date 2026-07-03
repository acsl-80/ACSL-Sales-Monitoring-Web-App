import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardLayout from "../components/DashboardLayout";
import PageHeader from "../components/PageHeader";
import { Users } from "lucide-react";
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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Download,
  Loader2,
} from "lucide-react";
import salesAdvancedService from "../services/salesAdvancedAPIService";
import { lgaAndStates } from "../constants";
import AdminSalesDetailModal from "../admin/components/sales/AdminSalesDetailModal";

const formatDate = (dateStr) => {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const EndUserRecordsContent = () => {
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

  const handleExport = () => {
    const headers = [
      "Stove ID",
      "Sales Date",
      "Contact Person",
      "Phone Number",
      "Partner",
      "End User",
      "State",
      "LGA",
    ];
    const rows = filteredSales.map((s) => [
      s.stove_serial_no || "",
      formatDate(s.sales_date || s.created_at),
      s.contact_person || "",
      s.phone || s.contact_phone || "",
      s.partner_name || s.organizations?.name || s.organizations?.partner_name || "",
      s.end_user_name || "",
      s.state_backup || "",
      s.lga_backup || "",
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
                className="bg-white text-sm h-9"
              />
            </div>

            <div className="flex-1 min-w-[140px] max-w-[180px]">
              <Select value={selectedState} onValueChange={(v) => { setSelectedState(v); setSelectedLGA("all"); }}>
                <SelectTrigger className="bg-white text-sm h-9">
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
                  <SelectTrigger className="bg-white text-sm h-9">
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
                className="bg-white w-[140px] h-9 text-sm"
              />
              <span className="text-gray-400 text-sm">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-white w-[140px] h-9 text-sm"
              />
            </div>

            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="flex items-center gap-1 h-9 px-3 rounded-none"
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
            <div className="bg-[#eef3c4] rounded-t-lg px-4 py-2 flex items-center justify-between">
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
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">Stove ID</TableHead>
                    <TableHead
                      className="text-white font-semibold py-2 px-2 whitespace-nowrap cursor-pointer select-none"
                      onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                    >
                      <div className="flex items-center gap-1">
                        Sales Date
                      </div>
                    </TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">Contact Person</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">Phone Number</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">Partner</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">End User</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">State</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap">LGA</TableHead>
                    <TableHead className="text-white font-semibold py-2 px-2 whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        {searchTerm || hasActiveFilters
                          ? "No records found matching your filters."
                          : "No end user records available."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSales.map((sale, idx) => (
                      <TableRow
                        key={sale.id}
                        className={`${idx % 2 === 0 ? "bg-white" : "bg-[#eef3c4]"} hover:bg-gray-50`}
                      >
                        <TableCell className="py-2 px-2 font-medium whitespace-nowrap">
                          {sale.stove_serial_no || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {formatDate(sale.sales_date || sale.created_at)}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {sale.contact_person || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {sale.phone || sale.contact_phone || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {sale.partner_name || sale.organizations?.name || sale.organizations?.partner_name || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {sale.end_user_name || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {sale.state_backup || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          {sale.lga_backup || "N/A"}
                        </TableCell>
                        <TableCell className="py-2 px-2 whitespace-nowrap text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 rounded-none border-[#4a5d0f] text-[#4a5d0f] hover:bg-[#eef3c4]"
                            onClick={() => setSelectedSale(sale)}
                          >
                            Details
                          </Button>
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
    </DashboardLayout>
  );
};

export default EndUserRecordsContent;

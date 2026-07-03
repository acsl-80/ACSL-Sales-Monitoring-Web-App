
import React, { useState, useEffect, useCallback } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import PageHeader from "../../components/PageHeader";
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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeftRight,
  Search,
  X,
  Loader2,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Ban,
} from "lucide-react";
import transferHistoryService, { TransferRecord } from "../../services/transferHistoryService";
import CancelPurchaseModal from "./CancelPurchaseModal";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Stove IDs Modal ──────────────────────────────────────────────────────────

function StoveIdsModal({
  record,
  isOpen,
  onClose,
}: {
  record: TransferRecord | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (isOpen) setSearch("");
  }, [isOpen]);

  if (!record) return null;
  const stoves = record.stove_ids ?? [];
  const filtered = stoves.filter(
    (s) => !search || s.stove_id?.toLowerCase().includes(search.toLowerCase())
  );

  const fileSlug = `${record.partner_name?.replace(/\s+/g, "-").toLowerCase() ?? "partner"}-${record.transaction_id ?? "transfer"}`;

  const downloadCSV = () => {
    const headers = ["Stove ID", "Factory", "Sales Reference"];
    const rows = filtered.map((s) => [s.stove_id, s.factory || "", s.sales_reference || ""]);
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <div>
            <DialogTitle className="text-base font-bold text-foreground">
              Transferred Stove IDs
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Partner: <span className="font-semibold text-primary">{record.partner_name}</span>
            </p>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className=" space-y-3 overflow-y-auto flex-1">
          {/* Summary */}
          <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
            <div className="flex items-center justify-between border-b border-primary/20 pb-0.5 mb-2">
              <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">Transfer Summary</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Total Stoves</p>
                <p className="text-xs font-medium">{stoves.length.toLocaleString()}</p>
              </div>
              <div className="space-y-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Transfer Date</p>
                <p className="text-xs font-medium">{formatDate(record.transfer_date)}</p>
              </div>
              <div className="space-y-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Transaction ID</p>
                <p className="text-xs font-mono font-medium">{record.transaction_id || "—"}</p>
              </div>
            </div>
          </div>

          {/* Filter & Search */}
          {/* <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
            <div className="flex items-center justify-between border-b border-primary/20 pb-0.5 mb-2">
              <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">Search</h3>
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search stove ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-background"
              />
            </div>
          </div> */}

          {/* Stove IDs */}
          <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
            <div className="flex items-center justify-between border-b border-primary/20 pb-0.5 mb-2">
              <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                Stove IDs{filtered.length > 0 ? ` (${filtered.length})` : ""}
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={downloadCSV}
                disabled={filtered.length === 0}
              >
                <Download className="h-3 w-3" />CSV
              </Button>
            </div>

            {stoves.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">No stove IDs recorded.</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">No stove IDs match your search.</div>
            ) : (
              <div className="grid grid-cols-4 md:grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
                {filtered.map((s) => (
                  <div
                    key={s.stove_id}
                    className="px-2 py-1 text-xs rounded border text-center truncate  bg-muted/50 border-border/50 text-foreground cursor-default" 
                    title={[s.stove_id, s.factory && `Factory: ${s.factory}`, s.sales_reference && `Ref: ${s.sales_reference}`].filter(Boolean).join(" · ")}
                  >
                    {s.stove_id}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main content ─────────────────────────────────────────────────────────────

export default function StoveTransferHistoryContent() {
  const [records, setRecords] = useState<TransferRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePreset, setDatePreset] = useState<"today" | "1w" | "1m" | "6m" | "year" | "custom" | "">("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<TransferRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelRecord, setCancelRecord] = useState<TransferRecord | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startRecord = records.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(page * pageSize, totalCount);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await transferHistoryService.getHistory({
        search: search.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        sort_order: sortOrder,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setRecords(response.data);
      setTotalCount(response.pagination.total);
    } catch (e: any) {
      setError(e.message ?? "Failed to load transfer history");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, dateFrom, dateTo, sortOrder]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    setPage(1);
  }, [search, dateFrom, dateTo, sortOrder, pageSize]);

  const applyPreset = (preset: "today" | "1w" | "1m" | "6m" | "year" | "custom") => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now);
    if (preset === "today") { /* from = today */ }
    else if (preset === "1w") from.setDate(from.getDate() - 7);
    else if (preset === "1m") from.setMonth(from.getMonth() - 1);
    else if (preset === "6m") from.setMonth(from.getMonth() - 6);
    else if (preset === "year") { from.setMonth(0); from.setDate(1); }
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to);
  };

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setDatePreset("");
  };

  const openModal = (record: TransferRecord) => {
    setSelectedRecord(record);
    setModalOpen(true);
  };

  const sourceLabel = (source: string) =>
    source === "external-csv-sync" ? "CSV Sync" : "JSON Sync";

  const getVisiblePages = () => {
    const pages: number[] = [];
    let start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  if (loading && records.length === 0) {
    return (
      <DashboardLayout currentRoute="stove-transfer-history" title="Purchases from ACSL">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin h-8 w-8 text-brand" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <DashboardLayout currentRoute="stove-transfer-history" title="Purchases from ACSL">
        <div className="p-6 space-y-5">
          <PageHeader title="Purchases from ACSL" icon={ArrowLeftRight} />

          {/* Filter bar */}
          <div className="bg-[#FAFCFD] p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3">
            <div className="w-1/4 min-w-[180px] relative">
              <Input
                placeholder="Search partner, state, transaction ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white h-9 text-xs"
              />
            </div>

            {/* Date preset dropdown */}
            <Select
              value={datePreset}
              onValueChange={(v) => applyPreset(v as Parameters<typeof applyPreset>[0])}
            >
              <SelectTrigger className="w-[140px] h-9 bg-white text-xs">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="1w">1 Week</SelectItem>
                <SelectItem value="1m">1 Month</SelectItem>
                <SelectItem value="6m">6 Months</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>

            {/* Custom date inputs — shown only in custom mode */}
            {datePreset === "custom" && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 whitespace-nowrap">From:</span>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="bg-white h-9 text-xs w-[140px]"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 whitespace-nowrap">To:</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="bg-white h-9 text-xs w-[140px]"
                  />
                </div>
              </>
            )}

            {(search || dateFrom || dateTo || datePreset) && (
              <Button
                onClick={clearFilters}
                size="sm"
                variant="outline"
                className="h-9 text-xs"
              >
                <X className="h-4 w-4 mr-1" />
                Reset Filters
              </Button>
            )}

            <div className="flex items-center gap-3 ml-auto">
              <p className="text-sm text-gray-600">
                Showing{" "}
                <span className="font-medium">
                  {startRecord}–{endRecord}
                </span>{" "}
                of <span className="font-medium">{totalCount}</span> records
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">per page:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(v) => setPageSize(parseInt(v))}
                >
                  <SelectTrigger className="w-[65px] h-7 bg-white text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s.toString()}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs font-bold text-[#4a5d0f]">
                Total: <span>{totalCount}</span>
              </p>
            </div>
          </div>


          {/* Table */}
          <div className="space-y-0">
            <div className="bg-white border border-gray-200 overflow-x-auto relative">
              {loading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <Loader2 className="h-6 w-6 animate-spin text-brand" />
                </div>
              )}

              {error ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <p className="text-sm text-red-500">{error}</p>
                  <Button variant="outline" size="sm" onClick={fetchRecords}>
                    Retry
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">
                        <button
                          className="flex items-center gap-1 hover:opacity-80"
                          onClick={() => setSortOrder((s) => s === "desc" ? "asc" : "desc")}
                        >
                          Transaction ID
                          {sortOrder === "desc" ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUp className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">
                        Sales Date
                      </TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">
                        Partner Name
                      </TableHead>
                      <TableHead className="text-center text-white font-semibold text-sm whitespace-nowrap">
                        Stoves
                      </TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">
                        State
                      </TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">
                        Branch
                      </TableHead>
                      <TableHead className="text-white font-semibold text-sm whitespace-nowrap">
                        Sales Factory
                      </TableHead>
                      <TableHead className="text-center text-white font-semibold text-sm whitespace-nowrap">
                        Action
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={loading ? "opacity-40" : ""}>
                    {records.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10">
                          <ArrowLeftRight className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500 font-medium text-sm">No transfer records found</p>
                          <p className="text-gray-400 text-xs">Try adjusting your search</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      records.map((record, idx) => (
                        <TableRow
                          key={record.id}
                          className={`${idx % 2 === 0 ? "bg-white" : "bg-[#eef3c4]/40"} hover:bg-[#eef3c4] text-gray-700`}
                        >
                          <TableCell className="font-mono text-sm text-gray-600">
                            {record.transaction_id}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {record.sales_date
                              ? new Date(record.sales_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm font-medium text-gray-900">
                            {record.partner_name}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center justify-center min-w-[2rem] text-sm font-semibold px-2 py-0.5 rounded-full bg-[#eef3c4] text-[#4a5d0f]">
                              {record.stove_count}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{record.state || "—"}</TableCell>
                          <TableCell className="text-sm">{record.branch || "—"}</TableCell>
                          <TableCell className="text-sm">{record.sales_factory || "—"}</TableCell>
                          <TableCell className="text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 rounded-none"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-xs">
                                <DropdownMenuItem disabled className="flex flex-col items-start gap-0.5 opacity-100">
                                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Transfer Date</span>
                                  <span className="font-medium">{formatDate(record.transfer_date)}</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => openModal(record)} className="cursor-pointer gap-2">
                                  <Eye className="h-3.5 w-3.5" />
                                  View Stove IDs
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() => { setCancelRecord(record); setCancelOpen(true); }}
                                  className="cursor-pointer gap-2 text-red-600 focus:text-red-700"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  Cancel Purchase
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}

            </div>

            {/* Pagination */}
            <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
                <p className="text-sm text-gray-600">
                  Showing {startRecord} to {endRecord} of {totalCount} records
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Prev
                  </Button>
                  {getVisiblePages().map((p) => (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="sm"
                      className={`h-8 w-8 p-0 text-sm ${p === page ? "bg-black text-white hover:bg-black" : ""}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setPage(totalPages)}
                    disabled={page >= totalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
            </div>
          </div>
        </div>
      </DashboardLayout>

      <StoveIdsModal
        record={selectedRecord}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />

      <CancelPurchaseModal
        record={cancelRecord}
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={fetchRecords}
      />
    </>
  );
}

/**
 * The stoves in one state, paged on the server.
 *
 * Slice 10a of the 2026-09-02 review (finding F8). The States Performance
 * Report used to carry every stove of every state in the browser so this
 * modal could search and page them locally; at 22,000 stoves that was the
 * lag. The modal now asks for one page at a time, with the search and the
 * status filter applied by the database, and its export walks the server
 * five hundred rows at a time.
 */

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Loader2, Search, X } from "lucide-react";
import { downloadCSV } from "@/utils/csvExportUtils";
import { useSettled } from "@/lib/useSettled";
import {
  fetchAllStateStoves,
  useStateStoves,
  type StoveQuery,
  type StoveStatus,
} from "../hooks/useStatesPerformance";
import { Pill } from "./reportBits";

const PAGE_SIZES = [25, 50, 100, 200];

function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}

const csvCell = (value: string | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export interface StateStovesModalProps {
  open: boolean;
  state: string | null;
  /** The pill that opened the modal decides the first status filter. */
  initialStatus: StoveStatus;
  summary: { stoves: number; sold: number; notSold: number } | null;
  onClose: () => void;
}

export default function StateStovesModal({ open, state, initialStatus, summary, onClose }: StateStovesModalProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StoveStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const settledSearch = useSettled(search);

  // Opening for another state, or from another pill, starts clean.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setStatus(initialStatus);
    setPage(1);
    setExportNote(null);
  }, [open, state, initialStatus]);

  useEffect(() => setPage(1), [settledSearch, status, pageSize]);

  const query: StoveQuery = useMemo(
    () => ({ state: open ? state : null, status, search: settledSearch, page, limit: pageSize }),
    [open, state, status, settledSearch, page, pageSize],
  );
  const stoves = useStateStoves(query);

  const totalPages = Math.max(1, Math.ceil(stoves.total / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;

  const handleExport = async () => {
    try {
      setExporting(true);
      setExportNote(null);
      const { rows, total, truncated } = await fetchAllStateStoves({ ...query, page: 1 }, (p) =>
        setExportNote(`Exporting ${formatNumber(p.fetched)} of ${formatNumber(p.total)} stoves...`),
      );
      const headers = ["#", "Stove ID", "Partner", "State", "Status"];
      const lines = [headers.join(",")].concat(
        rows.map((s, i) => [i + 1, csvCell(s.stove_id), csvCell(s.partner_name), csvCell(state), s.status].join(",")),
      );
      downloadCSV(
        lines.join("\n"),
        `stoves-in-${(state || "state").toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`,
      );
      setExportNote(
        truncated
          ? `The export was cut at its ceiling: ${formatNumber(rows.length)} of ${formatNumber(total)} stoves are in the file. Narrow the search to export the rest.`
          : `Export ready, ${formatNumber(rows.length)} stoves in the file.`,
      );
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : "The export did not run.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="border-b bg-[#4a5d0f] px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold text-white">Stove IDs in {state}</DialogTitle>
              <DialogDescription className="text-white/80 text-xs">
                {formatNumber(summary?.stoves ?? 0)} total · {formatNumber(summary?.sold ?? 0)} sold ·{" "}
                {formatNumber(summary?.notSold ?? 0)} available
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 space-y-3 p-5 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search stove ID or partner..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9 shadow-none"
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as StoveStatus)}>
              <SelectTrigger className="h-9 w-[140px] shadow-none" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sold">Sold</SelectItem>
                <SelectItem value="available">Available</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleExport}
              disabled={exporting || stoves.total === 0}
              className="h-9 bg-[#4a5d0f] text-white hover:bg-[#3a4a0c] shadow-none"
            >
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {exporting ? "Exporting" : "Export CSV"}
            </Button>
          </div>
          {exportNote && (
            <p role="status" className="text-xs text-gray-600 shrink-0">
              {exportNote}
            </p>
          )}

          <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#e5e7eb]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eef3c4] hover:bg-[#eef3c4]">
                  <TableHead className="w-12 text-left text-[11px] font-semibold text-[#4a5d0f]">#</TableHead>
                  <TableHead className="text-left text-[11px] font-semibold text-[#4a5d0f]">Stove ID</TableHead>
                  <TableHead className="text-left text-[11px] font-semibold text-[#4a5d0f]">Partner</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stoves.isPending ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-gray-500">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Loading stoves...
                    </TableCell>
                  </TableRow>
                ) : stoves.error ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-red-600">
                      {stoves.error}
                    </TableCell>
                  </TableRow>
                ) : stoves.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-gray-500">
                      No stoves found.
                    </TableCell>
                  </TableRow>
                ) : (
                  stoves.rows.map((s, i) => (
                    <TableRow key={`${s.stove_id}-${i}`} className="border-b text-xs">
                      <TableCell className="align-top text-gray-500">{start + i + 1}</TableCell>
                      <TableCell className="align-top">
                        <span className="font-mono text-[12px] font-medium text-gray-900">{s.stove_id}</span>
                      </TableCell>
                      <TableCell className="align-top text-gray-700">{s.partner_name}</TableCell>
                      <TableCell className="text-center align-top">
                        {s.status === "sold" ? <Pill tone="emerald">Sold</Pill> : <Pill tone="slate">Available</Pill>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e5e7eb] pt-3 text-xs text-gray-600 shrink-0">
            <div aria-live="polite">
              Showing {stoves.total === 0 ? 0 : formatNumber(start + 1)} to{" "}
              {formatNumber(Math.min(start + pageSize, stoves.total))} of {formatNumber(stoves.total)} stoves
              {stoves.isFetching && !stoves.isPending ? " (updating)" : ""}
            </div>
            <div className="flex items-center gap-2">
              <span>per page:</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[80px] shadow-none" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 shadow-none"
                disabled={clampedPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="px-2">
                Page {clampedPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shadow-none"
                disabled={clampedPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


import React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { AdminSales } from "@/types/adminSales";
import FinancialReportRowActions from "./FinancialReportRowActions";

interface FinancialReportsTableProps {
  data: AdminSales[];
  loading: boolean;
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onViewDetails: (sale: AdminSales) => void;
  onViewHistory: (sale: AdminSales) => void;
  onRecordPayment: (sale: AdminSales) => void;
  onApproveSale?: (sale: AdminSales) => void;
  onEditSale?: (sale: AdminSales) => void;
  onDeleteSale?: (sale: AdminSales) => void;
  onCancelSale?: (sale: AdminSales) => void;
  sortOrder: "asc" | "desc";
  onToggleSort: () => void;
  // "admin" shows Agent column, "superAdmin" shows Partner column, "agent" hides both
  viewFrom?: "admin" | "superAdmin" | "agent";
}

const formatCurrency = (amount: number) =>
  `₦${(amount ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;

const formatDate = (dateStr: string) => {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
};

const getAmountPaid = (sale: AdminSales): number =>
  sale.total_paid ?? (sale.is_installment ? 0 : (sale.amount ?? 0));

const getAmountOwed = (sale: AdminSales): number =>
  Math.max(0, (sale.amount ?? 0) - getAmountPaid(sale));


const FinancialReportsTable: React.FC<FinancialReportsTableProps> = ({
  data, loading, currentPage, pageSize, totalRecords,
  onPageChange, onPageSizeChange, onViewDetails, onViewHistory, onRecordPayment,
  onApproveSale, onEditSale, onDeleteSale, onCancelSale, sortOrder, onToggleSort, viewFrom = "admin",
}) => {
  const totalPages = Math.ceil(totalRecords / pageSize);
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);

  const getVisiblePages = () => {
    const pages: number[] = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  if (data.length === 0 && !loading) {
    return (
      <div className="text-gray-500 flex flex-col py-10 items-center justify-center border border-gray-200 rounded-lg">
        <p className="text-lg font-medium">No records found</p>
        <p className="text-sm">Try adjusting your filters or check back later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Pagination header */}
      <div className="rounded-t-lg px-4 py-2 flex items-center justify-end gap-3">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
          <span className="font-medium">{totalRecords}</span> records
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">per page:</span>
          <Select value={pageSize.toString()} onValueChange={(val) => onPageSizeChange(Number(val))}>
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

      {/* Table */}
      <div className="bg-white border-x border-gray-200 overflow-x-auto mt-1">
        <Table className="text-sm">
          <TableHeader className="bg-[#4a5d0f]">
            <TableRow className="hover:bg-[#4a5d0f]">
              <TableHead className="text-white font-semibold py-2 px-1 whitespace-nowrap">Trans #</TableHead>
              <TableHead
                className="text-white font-semibold py-2 px-1 whitespace-nowrap cursor-pointer select-none"
                onClick={onToggleSort}
              >
                <div className="flex items-center gap-1">
                  Date <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>
               <TableHead className="text-white font-semibold py-2 px-1 whitespace-nowrap">End User</TableHead>
               <TableHead className="text-white font-semibold py-2 px-1 whitespace-nowrap">State</TableHead>
               <TableHead className="text-white font-semibold py-2 px-1 whitespace-nowrap">Stove ID</TableHead>
               <TableHead className="text-white font-semibold py-2 px-1 whitespace-nowrap">Payment Model</TableHead>
               <TableHead className="text-white font-semibold py-2 px-1 text-right whitespace-nowrap">Expected</TableHead>
              <TableHead className="text-white font-semibold py-2 px-1 text-right whitespace-nowrap">Paid</TableHead>
              <TableHead className="text-white font-semibold py-2 px-1 text-right whitespace-nowrap">Balance</TableHead>
              <TableHead className="text-white font-semibold py-2 px-1 text-center whitespace-nowrap"> </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={loading ? "opacity-40" : ""}>
            {data.map((sale, idx) => (
              <TableRow
                key={sale.id}
                className={`${idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]"} hover:bg-gray-100`}
              >
                <TableCell className="py-1 px-1 font-medium whitespace-nowrap">{sale.transaction_id || "N/A"}</TableCell>
                <TableCell className="py-1 px-1 whitespace-nowrap">{formatDate(sale.sales_date || sale.created_at)}</TableCell>
                <TableCell className="py-1 px-1 whitespace-nowrap">{sale.end_user_name || "N/A"}</TableCell>
                <TableCell className="py-1 px-1 whitespace-nowrap">{sale.state_backup || "N/A"}</TableCell>
                <TableCell className="py-1 px-1 whitespace-nowrap">{sale.stove_serial_no || "N/A"}</TableCell>
                <TableCell className="py-1 px-1 whitespace-nowrap">
                  {sale.is_installment
                    ? (sale.payment_model?.name || "Installment")
                    : "Full Payment"}
                </TableCell>
                <TableCell className="py-1 px-1 text-right font-bold whitespace-nowrap">
                  {formatCurrency(sale.amount ?? 0)}
                </TableCell>
                <TableCell className="py-1 px-1 text-right text-green-700 font-medium whitespace-nowrap">
                  {formatCurrency(getAmountPaid(sale))}
                </TableCell>
                <TableCell className="py-1 px-1 text-right text-red-700 font-medium whitespace-nowrap">
                  {formatCurrency(getAmountOwed(sale))}
                </TableCell>
                <TableCell className="py-1 px-1 text-center">
                  <FinancialReportRowActions
                    sale={sale}
                    onViewDetails={onViewDetails}
                    onViewHistory={onViewHistory}
                    onRecordPayment={onRecordPayment}
                    onApproveSale={onApproveSale}
                    onEditSale={onEditSale}
                    onDeleteSale={onDeleteSale}
                    onCancelSale={onCancelSale}
                    viewFrom={viewFrom}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
          <p className="text-sm text-gray-600">
            Showing {startRecord} to {endRecord} of {totalRecords} records
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => onPageChange(1)} disabled={currentPage === 1}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />Prev
            </Button>
            {getVisiblePages().map((p) => (
              <Button key={p} variant={p === currentPage ? "default" : "outline"} size="sm"
                className={`h-8 w-8 p-0 ${p === currentPage ? "bg-[#4a5d0f] text-white hover:bg-[#4a5d0f]" : ""}`}
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialReportsTable;

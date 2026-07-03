import React from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eye, MoreVertical, Edit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminSales } from "@/types/adminSales";

const getPaymentStatusBadge = (sale: AdminSales) => {
  if (!sale.is_installment) return null;
  const status = sale.payment_status;
  if (status === "fully_paid") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
        Fully Paid
      </Badge>
    );
  }
  if (status === "partially_paid") {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
          Partially Paid
        </Badge>
        <span className="text-xs text-gray-500">
          ₦{(sale.total_paid ?? 0).toLocaleString()} / ₦{sale.amount.toLocaleString()}
        </span>
      </div>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
      Installment
    </Badge>
  );
};

interface SalesTableProps {
  salesData: AdminSales[];
  formatCurrency: (amount: number) => string;
  formatDate: (date: string) => string;
  getStatusBadge: (status: string) => React.ReactNode;
  viewSaleDetails: (sale: AdminSales | null) => void;
  editSale: (sale: AdminSales) => void;
  loading: boolean;
}

const SalesTable: React.FC<SalesTableProps> = ({
  salesData,
  formatCurrency,
  formatDate,
  getStatusBadge,
  viewSaleDetails,
  editSale,
  loading,
}) => {
  if (salesData.length === 0) {
    return (
      <div className="text-gray-500 flex flex-col py-10 items-center justify-center px-10">
        <p className="text-lg font-medium">No sales found</p>
        <p className="text-sm mb-4">
          Try adjusting your search criteria or create a new sale
        </p>
        <Button
          onClick={() => viewSaleDetails(null)}
          className="bg-brand hover:bg-brand-700 text-white"
        >
          Create First Sale
        </Button>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 relative">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Partner</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Serial No</TableHead>
            <TableHead>State</TableHead>
            <TableHead>LGA</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={loading ? "opacity-40" : ""}>
          {salesData.map((sale, idx) => (
            <TableRow key={sale.id} className="hover:bg-gray-50 text-gray-700">
              <TableCell className="font-medium">
                {sale.end_user_name || "N/A"}
              </TableCell>
              <TableCell>{sale.phone || "N/A"}</TableCell>
              <TableCell>{sale.partner_name || "N/A"}</TableCell>
              <TableCell>{formatCurrency(sale.amount ?? 0)}</TableCell>
              <TableCell>{sale.stove_serial_no || "N/A"}</TableCell>
              <TableCell>{sale.state_backup || "N/A"}</TableCell>
              <TableCell>{sale.lga_backup || "N/A"}</TableCell>
              <TableCell>{getStatusBadge(sale.status ?? "N/A")}</TableCell>
              <TableCell>
                {getPaymentStatusBadge(sale) || (
                  <span className="text-xs text-gray-400">Full Payment</span>
                )}
              </TableCell>
              <TableCell>{formatDate(sale.created_at ?? "N/A")}</TableCell>
              <TableCell className="text-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => viewSaleDetails(sale)}
                      className="py-2 px-3 rounded-md hover:!bg-primary hover:!text-white"
                    >
                      <Eye className="mr-5 h-4 w-4" />
                      View Details
                    </DropdownMenuItem>
                    <hr className="border-gray-200" />
                    <DropdownMenuItem
                      onClick={() => editSale(sale)}
                      className="py-2 px-3 rounded-md hover:!bg-primary hover:!text-white"
                    >
                      <Edit className="mr-5 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default SalesTable;
